import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DraftSectionSchema } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateDraftSchema = z.object({
  title: z.string().min(1),
  sections: z.array(DraftSectionSchema).min(1),
});

// 사용자가 화면에서 AI가 쓴 글을 발행 전에 직접 고칠 수 있게 한다.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; draftId: string }> },
) {
  const { id, draftId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = UpdateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다", detail: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare(`SELECT id FROM drafts WHERE id = ? AND job_id = ?`).get(draftId, id);
  if (!existing) {
    return NextResponse.json({ error: "초안을 찾을 수 없습니다" }, { status: 404 });
  }

  db.prepare(`UPDATE drafts SET title = ?, body_json = ? WHERE id = ?`).run(
    parsed.data.title,
    JSON.stringify(parsed.data.sections),
    draftId,
  );

  return NextResponse.json({ ok: true });
}
