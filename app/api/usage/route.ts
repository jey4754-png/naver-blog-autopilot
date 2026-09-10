import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getUsage } from "@/lib/ai/cfUsage";
import { neuronsPerImage, FREE_DAILY_NEURONS } from "@/lib/ai/neurons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getSettings();
  const db = getDb();

  // ⚠️ 7-22: 하루 발행 수도 로컬 날짜 기준으로 집계한다.
  const todayCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts
       WHERE status = 'published' AND date(published_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };

  const usage = await getUsage(settings.cfImageSteps);

  return NextResponse.json({
    todayPublishCount: todayCount.n,
    dailyPublishLimit: settings.dailyPublishLimit,
    usage: {
      neurons: usage.neurons,
      isEstimate: usage.isEstimate,
      note: usage.note,
      freeDailyNeurons: FREE_DAILY_NEURONS,
    },
    neuronsPerImage: neuronsPerImage(settings.cfImageSteps),
  });
}
