import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  if (!job) {
    return NextResponse.json({ error: "잡을 찾을 수 없습니다" }, { status: 404 });
  }

  const ideas = db.prepare(`SELECT * FROM ideas WHERE job_id = ? ORDER BY created_at`).all(id);
  const drafts = db.prepare(`SELECT * FROM drafts WHERE job_id = ? ORDER BY created_at`).all(id) as {
    id: string;
    body_json: string;
    [key: string]: unknown;
  }[];
  const images = db.prepare(`SELECT * FROM images WHERE job_id = ? ORDER BY created_at`).all(id);
  const posts = db.prepare(`SELECT * FROM posts WHERE job_id = ? ORDER BY created_at DESC`).all(id);

  const parsedDrafts = drafts.map((d) => ({ ...d, sections: JSON.parse(d.body_json) }));

  return NextResponse.json({ job, ideas, drafts: parsedDrafts, images, posts });
}
