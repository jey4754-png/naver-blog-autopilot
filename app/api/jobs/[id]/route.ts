import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠️ 화면(app/page.tsx)은 /api/file?path=<data 폴더 기준 상대경로> 로 이미지를 불러온다.
// local_path/screenshot 는 better-sqlite3에 저장된 "그 OS의" 절대경로라서, 윈도우에서는
// 구분자가 \ 다. 클라이언트가 "/data/" 문자열을 찾아 직접 잘라 쓰면 윈도우에서 항상
// 실패한다 — 여기서 서버가 OS에 안전한 상대경로(항상 / 구분자)를 미리 계산해 내려준다.
function toFileUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const rel = path.relative(dataRoot, absPath).split(path.sep).join("/");
  return `/api/file?path=${encodeURIComponent(rel)}`;
}

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
  const images = db.prepare(`SELECT * FROM images WHERE job_id = ? ORDER BY created_at`).all(id) as {
    local_path: string | null;
    [key: string]: unknown;
  }[];
  const posts = db.prepare(`SELECT * FROM posts WHERE job_id = ? ORDER BY created_at DESC`).all(id) as {
    screenshot: string | null;
    [key: string]: unknown;
  }[];

  const parsedDrafts = drafts.map((d) => ({ ...d, sections: JSON.parse(d.body_json) }));
  const imagesWithUrl = images.map((img) => ({ ...img, fileUrl: toFileUrl(img.local_path) }));
  const postsWithUrl = posts.map((p) => ({ ...p, screenshotUrl: toFileUrl(p.screenshot) }));

  return NextResponse.json({ job, ideas, drafts: parsedDrafts, images: imagesWithUrl, posts: postsWithUrl });
}
