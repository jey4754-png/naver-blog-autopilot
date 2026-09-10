import { NextResponse } from "next/server";
import { loginInteractive } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 로그인 창은 최대 5분까지 기다린다.

export async function POST() {
  const result = await loginInteractive();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
