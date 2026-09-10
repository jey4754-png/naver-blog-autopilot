import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page, BrowserContext } from "playwright";
import { newContext } from "@/lib/playwright";
import { judgeCrawledImage } from "@/lib/ai/vision";
import { getDb } from "@/lib/db";
import { jobLog } from "@/lib/log";
import { absDataPath } from "@/lib/paths";
import type { VisionVerdict } from "@/lib/types";

// ── 후보 수집 (6-6) ──────────────────────────────────────────
export interface RawImgCandidate {
  src: string;
  naturalWidth: number;
}

// 브라우저 안에서 실행되는 함수. page.evaluate 에 그대로 전달한다.
export function extractRawImgCandidates(): RawImgCandidate[] {
  return Array.from(document.querySelectorAll("img")).map((img) => ({
    src: (img as HTMLImageElement).src,
    naturalWidth: (img as HTMLImageElement).naturalWidth,
  }));
}

const BAD_SRC = /sprite|logo|icon|blank|\.svg/i;

export function filterImageCandidates(raw: RawImgCandidate[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    if (!c.src) continue;
    if (c.naturalWidth < 120) continue;
    if (BAD_SRC.test(c.src)) continue;
    if (seen.has(c.src)) continue;
    seen.add(c.src);
    out.push(c.src);
    if (out.length >= limit) break;
  }
  return out;
}

async function collectFromPage(page: Page, url: string, limit: number): Promise<string[]> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // ⚠️ 6-6: lazy 로딩 유도를 위해 스크롤을 한 번 내린다.
  await page.mouse.wheel(0, 2200);
  await page.waitForTimeout(800);
  const raw = await page.evaluate(extractRawImgCandidates);
  return filterImageCandidates(raw, limit);
}

// 네이버 이미지 검색 → 실패/부족 시 구글로 폴백한다.
export async function searchImageCandidates(page: Page, query: string, limit: number): Promise<string[]> {
  const naverUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(query)}`;
  let candidates: string[] = [];
  try {
    candidates = await collectFromPage(page, naverUrl, limit);
  } catch {
    candidates = [];
  }
  if (candidates.length > 0) return candidates;

  const googleUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  try {
    candidates = await collectFromPage(page, googleUrl, limit);
  } catch {
    candidates = [];
  }
  return candidates;
}

// ── 다운로드 ──────────────────────────────────────────────
const MIN_BYTES = 3000; // 이보다 작으면 아이콘/깨진 이미지로 간주해 버린다.

export async function downloadImage(
  context: BrowserContext,
  url: string,
  destPath: string,
): Promise<boolean> {
  try {
    const res = await context.request.get(url);
    if (!res.ok()) return false;
    const buf = await res.body();
    if (buf.length < MIN_BYTES) return false;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

// ── 탈락 사유 분류 (6-6) ────────────────────────────────────
export function categorizeRejection(v: VisionVerdict): "워터마크" | "국내 인물(초상권)" | "주제 불일치" {
  if (v.watermark) return "워터마크";
  if (v.koreanPerson) return "국내 인물(초상권)";
  return "주제 불일치";
}

// ── 자리 하나 채우기 ─────────────────────────────────────────
export interface FillSlotResult {
  path: string | null;
  srcUrl: string | null;
}

export async function fillImageSlot(
  jobId: string,
  draftId: string,
  sectionIndex: number,
  query: string,
  topic: string,
  candidateLimit: number,
): Promise<FillSlotResult> {
  const db = getDb();
  const { browser, context } = await newContext({ headless: true, useNaverSession: false });
  try {
    const page = await context.newPage();
    const candidates = await searchImageCandidates(page, query, candidateLimit);
    jobLog(jobId, "info", `"${query}" 이미지 후보 ${candidates.length}개 수집`);

    for (const url of candidates) {
      const tmpPath = absDataPath("images", `${randomUUID()}.tmp`);
      const downloaded = await downloadImage(context, url, tmpPath);
      if (!downloaded) {
        continue;
      }

      const verdict = await judgeCrawledImage(tmpPath, { topic, sectionQuery: query });
      if (verdict.fit) {
        const finalPath = absDataPath("images", `${randomUUID()}.jpg`);
        fs.renameSync(tmpPath, finalPath);
        db.prepare(
          `INSERT INTO images (id, job_id, draft_id, query, src_url, local_path, source_site, verdict_ok, verdict_reason, section_index)
           VALUES (?, ?, ?, ?, ?, ?, 'naver', 1, ?, ?)`,
        ).run(randomUUID(), jobId, draftId, query, url, finalPath, verdict.reason, sectionIndex);
        return { path: finalPath, srcUrl: url };
      }

      const category = categorizeRejection(verdict);
      db.prepare(
        `INSERT INTO images (id, job_id, draft_id, query, src_url, local_path, source_site, verdict_ok, verdict_reason, section_index)
         VALUES (?, ?, ?, ?, ?, NULL, 'naver', 0, ?, ?)`,
      ).run(randomUUID(), jobId, draftId, query, url, `${category}: ${verdict.reason}`, sectionIndex);
      fs.rmSync(tmpPath, { force: true });
    }

    jobLog(jobId, "warn", `"${query}" 자리에 맞는 사진을 찾지 못해 비워둡니다`);
    return { path: null, srcUrl: null };
  } finally {
    await browser.close().catch(() => {});
  }
}
