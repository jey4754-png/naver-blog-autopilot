import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { jobLog, setJobStage } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { scrapeTrends } from "@/lib/scrape/trends";
import { generateIdeas, generateDraft, sanitizeDraft } from "@/lib/ai/content";
import { generateExperienceDraft, generateBrandingDraft } from "@/lib/ai/templates";
import { fillImageSlot } from "@/lib/scrape/images";
import { generateSectionImage } from "@/lib/ai/imagegen";
import { listLocalPhotos, describeLocalPhotos, matchPhotosToCaptions, type PhotoBatchMode } from "@/lib/localPhotos";
import { verifySession } from "@/lib/naver/session";
import { publishToNaver } from "@/lib/naver/publish";
import type { Draft, ImageStyle, LocalPhotoDesc, PhotoSource, WriteMode } from "@/lib/types";

interface JobRow {
  id: string;
  keyword: string;
  mode: WriteMode;
  inputs: string;
}

interface AutoInputs {
  photoSource: Extract<PhotoSource, "crawl" | "ai" | "none">;
  imageStyle?: ImageStyle;
}

interface TemplateInputs {
  topic: string;
  keyPoints: string;
  photoSource: PhotoSource;
  photoFolder?: string;
  batchMode?: PhotoBatchMode;
  imageStyle?: ImageStyle;
}

function countImageSections(draft: Draft): number {
  return draft.sections.filter((s) => s.type === "image").length;
}

function nearbyParagraphText(draft: Draft, index: number, direction: -1 | 1): string {
  const step = direction;
  for (let i = index + step; i >= 0 && i < draft.sections.length && Math.abs(i - index) <= 3; i += step) {
    const s = draft.sections[i];
    if (s && (s.type === "paragraph" || s.type === "quote")) return s.text.slice(0, 400);
  }
  return "";
}

// ⚠️ 6-10: photoDescs 를 인자로 받아야 한다. 내부에서 다시 만들면 claude 호출이 배로 든다.
export interface FillImagesOpts {
  photoSource: PhotoSource;
  imageStyle: ImageStyle;
  photos?: string[]; // local 모드일 때 사용 가능한 사진 절대경로 목록
  photoDescs?: LocalPhotoDesc[]; // local 모드일 때, 본문 생성 단계에서 이미 만든 설명(재사용)
  batchMode?: PhotoBatchMode;
}

export async function fillImages(
  jobId: string,
  draftId: string,
  draft: Draft,
  opts: FillImagesOpts,
): Promise<Map<number, string>> {
  const settings = getSettings();
  const result = new Map<number, string>();
  const imageIndexes = draft.sections
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.type === "image");

  if (opts.photoSource === "none" || imageIndexes.length === 0) {
    return result;
  }

  if (opts.photoSource === "local") {
    const descs = opts.photoDescs ?? [];
    const captions = imageIndexes.map(({ s }) => (s.type === "image" ? s.query : ""));
    const matched = await matchPhotosToCaptions(descs, captions, opts.batchMode ?? "order");
    imageIndexes.forEach(({ i }, idx) => {
      const path = matched[idx];
      if (path) result.set(i, path);
    });
    jobLog(jobId, "info", `내 사진 ${matched.length}장을 자리에 배치했습니다`);
    return result;
  }

  if (opts.photoSource === "crawl") {
    for (const { s, i } of imageIndexes) {
      if (s.type !== "image") continue;
      const { path } = await fillImageSlot(jobId, draftId, i, s.query, draft.title, settings.imageCandidates);
      if (path) result.set(i, path);
    }
    return result;
  }

  // ai
  for (const { s, i } of imageIndexes) {
    if (s.type !== "image") continue;
    const { path } = await generateSectionImage({
      jobId,
      draftId,
      sectionIndex: i,
      title: draft.title,
      caption: s.caption ?? s.query,
      contextBefore: nearbyParagraphText(draft, i, -1),
      contextAfter: nearbyParagraphText(draft, i, 1),
      style: opts.imageStyle,
      steps: settings.cfImageSteps,
    });
    if (path) result.set(i, path);
  }
  return result;
}

function saveDraft(jobId: string, ideaId: string | null, draft: Draft): string {
  const db = getDb();
  const draftId = randomUUID();
  db.prepare(
    `INSERT INTO drafts (id, job_id, idea_id, title, body_json) VALUES (?, ?, ?, ?, ?)`,
  ).run(draftId, jobId, ideaId, draft.title, JSON.stringify(draft.sections));
  return draftId;
}

function saveSources(jobId: string, sources: { type: string; title: string; summary: string; url: string }[]) {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO sources (id, job_id, type, title, summary, url) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of sources) insert.run(randomUUID(), jobId, s.type, s.title, s.summary, s.url);
}

async function publishAndRecord(
  jobId: string,
  draftId: string,
  draft: Draft,
  imagePaths: Map<number, string>,
  headingAsQuote: boolean,
): Promise<void> {
  const db = getDb();
  setJobStage(jobId, { stage: "publishing" });

  const session = await verifySession();
  if (!session.valid) {
    const reason = session.reason ?? "네이버 로그인이 필요합니다";
    jobLog(jobId, "error", `발행할 수 없습니다: ${reason}`);
    db.prepare(
      `INSERT INTO posts (id, job_id, draft_id, status, note) VALUES (?, ?, ?, 'failed', ?)`,
    ).run(randomUUID(), jobId, draftId, reason);
    setJobStage(jobId, { status: "failed", error: reason });
    return;
  }

  // ⚠️ 6-10: 발행 단계에 15분 상한을 건다. 에디터가 멈추면 잡이 영원히 publishing 으로
  // 남는다.
  const TIMEOUT_MS = 15 * 60 * 1000;
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));

  const result = await Promise.race([
    publishToNaver({ jobId, draftId, draft, blogId: session.blogId, headingAsQuote, imagePaths }),
    timeoutPromise,
  ]);

  if (!result) {
    jobLog(jobId, "error", "발행이 15분 안에 끝나지 않아 중단했습니다");
    db.prepare(
      `INSERT INTO posts (id, job_id, draft_id, status, note) VALUES (?, ?, ?, 'failed', ?)`,
    ).run(randomUUID(), jobId, draftId, "발행이 15분 안에 끝나지 않았습니다. 글은 임시저장 상태로 남아 있을 수 있습니다");
    setJobStage(jobId, { status: "failed", error: "발행 시간 초과" });
    return;
  }

  const statusMap: Record<string, string> = {
    dry_run: "dry_run",
    published: "published",
    failed: "failed",
    blocked: "blocked",
  };
  const postStatus = statusMap[result.status] ?? "failed";
  const publishedAt = result.status === "published" ? new Date().toISOString().replace("T", " ").slice(0, 19) : null;

  db.prepare(
    `INSERT INTO posts (id, job_id, draft_id, status, blog_url, screenshot, note, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), jobId, draftId, postStatus, result.blogUrl ?? null, result.screenshot ?? null, result.note, publishedAt);

  if (result.status === "failed" || result.status === "blocked") {
    setJobStage(jobId, { status: result.status === "blocked" ? "failed" : "failed", error: result.note });
    jobLog(jobId, result.status === "blocked" ? "warn" : "error", result.note);
  } else {
    setJobStage(jobId, { status: "done" });
    jobLog(jobId, "info", result.note);
  }
}

async function runAutoJob(job: JobRow): Promise<void> {
  const inputs = JSON.parse(job.inputs) as AutoInputs;
  const settings = getSettings();

  setJobStage(job.id, { status: "scraping", stage: "collecting" });
  const sources = await scrapeTrends(job.keyword, settings.scrapeTopN);
  saveSources(job.id, sources);
  jobLog(job.id, "info", `자료 ${sources.length}건을 모았습니다`);

  setJobStage(job.id, { status: "writing", stage: "ideas" });
  const ideasRes = await generateIdeas(job.keyword, sources, 5);
  if (!ideasRes.ok) {
    jobLog(job.id, "error", `글감 생성 실패: ${ideasRes.error}`);
    setJobStage(job.id, { status: "failed", error: ideasRes.error });
    return;
  }
  const db = getDb();
  const insertIdea = db.prepare(
    `INSERT INTO ideas (id, job_id, title, angle, rationale, chosen) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const ideaIds: string[] = [];
  ideasRes.ideas.forEach((idea, i) => {
    const id = randomUUID();
    ideaIds.push(id);
    insertIdea.run(id, job.id, idea.title, idea.angle, idea.rationale, i === 0 ? 1 : 0);
  });
  const chosenIdea = ideasRes.ideas[0]!;
  jobLog(job.id, "info", `글감을 선택했습니다: ${chosenIdea.title}`);

  setJobStage(job.id, { stage: "draft" });
  const photoCount = inputs.photoSource === "none" ? 0 : 6;
  const draftRes = await generateDraft(job.keyword, chosenIdea, sources, {
    photoSource: inputs.photoSource,
    photoCount,
  });
  if (!draftRes.ok) {
    jobLog(job.id, "error", `본문 생성 실패: ${draftRes.error}`);
    setJobStage(job.id, { status: "failed", error: draftRes.error });
    return;
  }
  const draft = sanitizeDraft(job.id, draftRes.draft);
  const draftId = saveDraft(job.id, ideaIds[0]!, draft);
  jobLog(job.id, "info", `본문 생성 완료 (섹션 ${draft.sections.length}개, 이미지 자리 ${countImageSections(draft)}개)`);

  setJobStage(job.id, { status: "imaging", stage: "images" });
  const imagePaths = await fillImages(job.id, draftId, draft, {
    photoSource: inputs.photoSource,
    imageStyle: inputs.imageStyle ?? "photo",
  });
  jobLog(job.id, "info", `이미지 ${imagePaths.size}/${countImageSections(draft)}장을 채웠습니다`);

  await publishAndRecord(job.id, draftId, draft, imagePaths, false);
}

async function runTemplateJob(job: JobRow): Promise<void> {
  const inputs = JSON.parse(job.inputs) as TemplateInputs;

  let photos: string[] = [];
  let photoDescs: LocalPhotoDesc[] = [];
  if (inputs.photoSource === "local" && inputs.photoFolder) {
    setJobStage(job.id, { status: "scraping", stage: "local-photos" });
    photos = listLocalPhotos(inputs.photoFolder);
    jobLog(job.id, "info", `사진 ${photos.length}장을 찾았습니다`);
    // ⚠️ 6-8/6-10: 사진 설명은 여기서 한 번만 만들고, 본문 생성과 이미지 배치에 재사용한다.
    photoDescs = await describeLocalPhotos(photos);
  }

  setJobStage(job.id, { status: "writing", stage: "draft" });
  const templateOpts = {
    photoSource: inputs.photoSource,
    photoCount: inputs.photoSource === "local" ? photos.length : inputs.photoSource === "none" ? 0 : 6,
    photoDescs: photoDescs.map((d) => d.desc),
  };

  const draftRes =
    job.mode === "experience"
      ? await generateExperienceDraft(inputs.topic, inputs.keyPoints, templateOpts)
      : await generateBrandingDraft(inputs.topic, inputs.keyPoints, templateOpts);

  if (!draftRes.ok) {
    jobLog(job.id, "error", `본문 생성 실패: ${draftRes.error}`);
    setJobStage(job.id, { status: "failed", error: draftRes.error });
    return;
  }
  const draft = sanitizeDraft(job.id, draftRes.draft);
  const draftId = saveDraft(job.id, null, draft);
  jobLog(job.id, "info", `본문 생성 완료 (섹션 ${draft.sections.length}개, 이미지 자리 ${countImageSections(draft)}개)`);

  setJobStage(job.id, { status: "imaging", stage: "images" });
  const imagePaths = await fillImages(job.id, draftId, draft, {
    photoSource: inputs.photoSource,
    imageStyle: inputs.imageStyle ?? "photo",
    photos,
    photoDescs,
    batchMode: inputs.batchMode ?? "order",
  });
  jobLog(job.id, "info", `이미지 ${imagePaths.size}/${countImageSections(draft)}장을 채웠습니다`);

  // ⚠️ 6-9: 체험단·브랜딩 모드는 소제목도 인용구로 렌더링한다.
  await publishAndRecord(job.id, draftId, draft, imagePaths, true);
}

// 사용자가 화면에서 초안을 고친 뒤 "이 내용으로 다시 만들기"를 눌렀을 때 쓰인다.
// 자료 수집·글감·본문 생성은 다시 하지 않고, 이미 저장된(수정된) 초안과 이미 채워둔
// 사진을 그대로 써서 발행 단계만 다시 실행한다.
export async function republishDraft(jobId: string, draftId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare(`SELECT id, mode FROM jobs WHERE id = ?`).get(jobId) as
    | { id: string; mode: WriteMode }
    | undefined;
  if (!job) {
    jobLog(jobId, "error", "잡을 찾을 수 없습니다");
    return;
  }
  const draftRow = db
    .prepare(`SELECT id, title, body_json FROM drafts WHERE id = ? AND job_id = ?`)
    .get(draftId, jobId) as { id: string; title: string; body_json: string } | undefined;
  if (!draftRow) {
    jobLog(jobId, "error", "초안을 찾을 수 없습니다");
    return;
  }
  const draft: Draft = { title: draftRow.title, sections: JSON.parse(draftRow.body_json) };

  const imageRows = db
    .prepare(
      `SELECT section_index, local_path FROM images
       WHERE job_id = ? AND draft_id = ? AND verdict_ok = 1 AND local_path IS NOT NULL`,
    )
    .all(jobId, draftId) as { section_index: number | null; local_path: string }[];
  const imagePaths = new Map<number, string>();
  for (const row of imageRows) {
    if (row.section_index !== null) imagePaths.set(row.section_index, row.local_path);
  }

  setJobStage(jobId, { status: "publishing", stage: "publishing", error: "" });
  jobLog(jobId, "info", "수정한 내용으로 다시 시도합니다");
  await publishAndRecord(jobId, draftId, draft, imagePaths, job.mode !== "auto");
}

export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare(`SELECT id, keyword, mode, inputs FROM jobs WHERE id = ?`).get(jobId) as
    | JobRow
    | undefined;
  if (!job) {
    jobLog(jobId, "error", "잡을 찾을 수 없습니다");
    return;
  }

  try {
    if (job.mode === "auto") {
      await runAutoJob(job);
    } else {
      await runTemplateJob(job);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLog(jobId, "error", `예상치 못한 오류로 중단되었습니다: ${message}`);
    setJobStage(jobId, { status: "failed", error: message });
  }
}
