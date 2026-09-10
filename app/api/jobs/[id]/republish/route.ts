import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { republishDraft } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ draftId: z.string().min(1) });

const IN_PROGRESS_STATUSES = ["pending", "scraping", "writing", "imaging", "publishing"];

// 사용자가 화면에서 초안을 고친 뒤, 자료 수집·글쓰기부터 다시 하지 않고 발행 단계만
// 다시 시도한다 (수정한 텍스트 + 이미 채워둔 사진 그대로).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "draftId가 필요합니다" }, { status: 400 });
  }

  const db = getDb();
  const job = db.prepare(`SELECT id, status FROM jobs WHERE id = ?`).get(id) as
    | { id: string; status: string }
    | undefined;
  if (!job) {
    return NextResponse.json({ error: "잡을 찾을 수 없습니다" }, { status: 404 });
  }

  // 다른 작업이 이미 진행 중이면(자기 자신 제외) 막는다 — 7-16과 같은 원리.
  const otherInProgress = db
    .prepare(
      `SELECT id FROM jobs WHERE id != ? AND status IN (${IN_PROGRESS_STATUSES.map(() => "?").join(",")}) LIMIT 1`,
    )
    .get(id, ...IN_PROGRESS_STATUSES);
  if (otherInProgress || IN_PROGRESS_STATUSES.includes(job.status)) {
    return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다" }, { status: 409 });
  }

  republishDraft(id, parsed.data.draftId).catch((err) =>
    console.error(`[job ${id}] republish 처리되지 않은 오류:`, err),
  );

  return NextResponse.json({ ok: true });
}
