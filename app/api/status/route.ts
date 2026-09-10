import { NextRequest, NextResponse } from "next/server";
import { checkClaude } from "@/lib/claude";
import { verifySession, invalidateSessionCache } from "@/lib/naver/session";
import { hasCloudflareKeys } from "@/lib/ai/cfUsage";
import { getSettings, LIMITS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh) invalidateSessionCache();

  const [claude, naver] = await Promise.all([checkClaude(), verifySession({ forceRefresh: refresh })]);

  return NextResponse.json({
    claude,
    naver,
    cloudflareConfigured: hasCloudflareKeys(),
    settings: getSettings(),
    limits: LIMITS,
  });
}
