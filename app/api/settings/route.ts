import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings, resetSettings, isKnownSettingKey, LIMITS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다" }, { status: 400 });
  }

  if (body.reset === true) {
    resetSettings();
    return NextResponse.json({ settings: getSettings(), limits: LIMITS });
  }

  const unknownKeys = Object.keys(body).filter((k) => !isKnownSettingKey(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: `알 수 없는 설정 항목: ${unknownKeys.join(", ")}` }, { status: 400 });
  }

  setSettings(body);
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}
