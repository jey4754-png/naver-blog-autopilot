import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { dataRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ⚠️ 6-12: macOS는 process.cwd() 의 한글을 NFD(자모 분해)로 주는데 브라우저가 보내는
// URL 파라미터는 NFC(완성형)다. 정규화하지 않으면 한글 경로에서 startsWith 비교가
// false가 되어 이미지 미리보기가 전부 403이 된다.
function normalize(p: string): string {
  const n = path.resolve(p).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");
  if (!raw) {
    return NextResponse.json({ error: "path 파라미터가 필요합니다" }, { status: 400 });
  }

  const target = path.resolve(dataRoot, raw);
  const normalizedTarget = normalize(target);
  const normalizedRoot = normalize(dataRoot);

  // 경로 탈출 방지: data 디렉터리 바깥은 절대 서빙하지 않는다.
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
    return NextResponse.json({ error: "접근할 수 없는 경로입니다" }, { status: 403 });
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = EXT_TYPES[ext] ?? "application/octet-stream";
  const buf = fs.readFileSync(target);

  return new NextResponse(buf, { headers: { "Content-Type": contentType } });
}
