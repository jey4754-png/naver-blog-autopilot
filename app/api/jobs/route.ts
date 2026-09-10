import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { runJob } from "@/lib/pipeline";
import { ImageStyleSchema, PhotoSourceSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AutoJobSchema = z.object({
  mode: z.literal("auto"),
  keyword: z.string().min(1),
  photoSource: z.enum(["crawl", "ai", "none"]),
  imageStyle: ImageStyleSchema.optional(),
});

const TemplateJobSchema = z.object({
  mode: z.enum(["experience", "branding"]),
  topic: z.string().min(1),
  keyPoints: z.string().min(1),
  photoSource: PhotoSourceSchema,
  photoFolder: z.string().optional(),
  batchMode: z.enum(["order", "ai"]).optional(),
  imageStyle: ImageStyleSchema.optional(),
});

const CreateJobSchema = z.union([AutoJobSchema, TemplateJobSchema]);

const IN_PROGRESS_STATUSES = ["pending", "scraping", "writing", "imaging", "publishing"];

export async function GET() {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, keyword, status, stage, mode, created_at, updated_at FROM jobs ORDER BY created_at DESC LIMIT 30`,
    )
    .all();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다", detail: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const inProgress = db
    .prepare(
      `SELECT id FROM jobs WHERE status IN (${IN_PROGRESS_STATUSES.map(() => "?").join(",")}) LIMIT 1`,
    )
    .get(...IN_PROGRESS_STATUSES);
  if (inProgress) {
    return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다" }, { status: 409 });
  }

  const data = parsed.data;
  const keyword = data.mode === "auto" ? data.keyword : data.topic;
  const { mode, ...inputs } = data;
  const id = randomUUID();

  db.prepare(
    `INSERT INTO jobs (id, keyword, status, stage, auto, mode, inputs) VALUES (?, ?, 'pending', 'queued', ?, ?, ?)`,
  ).run(id, keyword, mode === "auto" ? 1 : 0, mode, JSON.stringify(inputs));

  // ⚠️ 6-10: fire-and-forget. API 라우트에서 await 하지 않는다 — 진행 상황은 SSE로 본다.
  runJob(id).catch((err) => console.error(`[job ${id}] 처리되지 않은 오류:`, err));

  return NextResponse.json({ id }, { status: 201 });
}
