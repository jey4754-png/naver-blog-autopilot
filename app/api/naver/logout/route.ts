import fs from "node:fs";
import { NextResponse } from "next/server";
import { paths } from "@/lib/paths";
import { invalidateSessionCache } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  fs.rmSync(paths.naverSession, { force: true });
  invalidateSessionCache();
  return NextResponse.json({ ok: true });
}
