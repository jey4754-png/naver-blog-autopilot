import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { polishDraftText } from "@/lib/ai/content";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사용자가 화면에서 "AI로 다듬기"를 누르면, 지금 저장되어 있는 초안 텍스트를
// 더 읽기 쉽게 다시 쓰게 한다. 섹션 개수·순서·이미지는 그대로 두고 글자만 다듬는다.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> },
) {
  const { id, draftId } = await params;
  const db = getDb();

  const draftRow = db
    .prepare(`SELECT id, title, body_json FROM drafts WHERE id = ? AND job_id = ?`)
    .get(draftId, id) as { id: string; title: string; body_json: string } | undefined;
  if (!draftRow) {
    return NextResponse.json({ error: "초안을 찾을 수 없습니다" }, { status: 404 });
  }

  const draft: Draft = { title: draftRow.title, sections: JSON.parse(draftRow.body_json) };
  const result = await polishDraftText(draft);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  db.prepare(`UPDATE drafts SET body_json = ? WHERE id = ?`).run(JSON.stringify(result.draft.sections), draftId);

  return NextResponse.json({ title: draftRow.title, sections: result.draft.sections });
}
