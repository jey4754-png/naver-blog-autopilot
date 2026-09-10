import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["done", "failed", "canceled"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const encoder = new TextEncoder();
  let lastLogId = 0;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = () => {
        if (closed) return;
        const rows = db
          .prepare(`SELECT id, level, message, created_at FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id`)
          .all(id, lastLogId) as { id: number; level: string; message: string; created_at: string }[];
        for (const row of rows) {
          lastLogId = row.id;
          send("log", row);
        }

        const job = db.prepare(`SELECT status, stage FROM jobs WHERE id = ?`).get(id) as
          | { status: string; stage: string | null }
          | undefined;

        if (!job || TERMINAL_STATUSES.has(job.status)) {
          send("end", job ?? { status: "unknown" });
          closed = true;
          clearInterval(interval);
          controller.close();
        }
      };

      const interval = setInterval(tick, 1000);
      tick();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // 이미 닫혔으면 무시.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
