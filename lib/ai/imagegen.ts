import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runClaudeJson } from "@/lib/claude";
import { GenVerdictSchema, genVerdictOk, type GenVerdict, type ImageStyle } from "@/lib/types";
import { getDb } from "@/lib/db";
import { jobLog } from "@/lib/log";
import { absDataPath } from "@/lib/paths";

// ⚠️ 6-7 / 7-13: 생성 이미지에는 워터마크도 초상권도 없다. 크롤링용 판정 함수
// (lib/ai/vision.ts, koreanPerson 등)를 그대로 재사용하면 멀쩡한 생성 이미지가
// 탈락한다. 별도 검증 함수(genVerdict)를 쓴다.

const STYLE_TOKENS: Record<ImageStyle, string> = {
  photo: "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust: "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};

const NEGATIVE_SUFFIX = "no text, no letters, no words, no watermark, no logo";

const PromptDesignSchema = z.object({ prompt: z.string().min(1) });

export interface DesignPromptInput {
  title: string;
  caption?: string;
  contextBefore?: string;
  contextAfter?: string;
  style: ImageStyle;
  retryReason?: string;
}

// ① claude -p 가 영문 프롬프트를 설계한다 (6-7).
export async function designImagePrompt(
  input: DesignPromptInput,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const retryNote = input.retryReason
    ? `\n\n이전 시도가 다음 이유로 실패했다. 이 문제를 피하도록 다시 설계하라: ${input.retryReason}`
    : "";

  const prompt = `다음은 네이버 블로그 글의 정보다.
글 제목: ${input.title}
이 사진 자리의 캡션/설명: ${input.caption ?? "(없음)"}
앞 문맥: ${(input.contextBefore ?? "").slice(0, 400)}
뒤 문맥: ${(input.contextAfter ?? "").slice(0, 400)}

이 자리에 넣을 이미지 생성 AI(FLUX)용 영문 프롬프트를 설계하라. 아래 규칙을 반드시 지켜라:
- 영어로, 한 문단, 40단어 이내로 작성하라.
- 피사체 / 구도 / 조명 / 배경 / 질감을 구체적으로 명시하라.
- 다음 스타일 토큰을 반드시 그대로 포함하라: "${STYLE_TOKENS[input.style]}"
- 프롬프트 끝에 반드시 다음을 그대로 붙여라: "${NEGATIVE_SUFFIX}"
- 실존 인물, 유명인, 브랜드 로고를 절대 넣지 마라.
- 사람이 필요하면 얼굴이 크게 나오지 않는 구도(손, 뒷모습, 실루엣)로 하라.
- 한국적 맥락은 반영하되 한글 간판·글자는 절대 넣지 마라(생성 모델이 한글을 깨뜨린다).${retryNote}

출력 형식: { "prompt": string }`;

  const res = await runClaudeJson(prompt, PromptDesignSchema, { retries: 1 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, prompt: res.data.prompt };
}

// ② Cloudflare Workers AI (FLUX) 로 생성한다.
const MIN_IMAGE_BYTES = 2000;
const GEN_TIMEOUT_MS = 90_000;

export function decodeGeneratedImage(base64: string): Buffer | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < MIN_IMAGE_BYTES) return null;
  return buf;
}

export type FluxResult = { ok: true; buffer: Buffer } | { ok: false; error: string };

export async function callFluxSchnell(prompt: string, steps: number): Promise<FluxResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return { ok: false, error: "Cloudflare 열쇠(계정 ID/토큰)가 설정되지 않았습니다" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, steps: Math.min(Math.max(steps, 1), 8) }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      return { ok: false, error: `이미지 생성 API 오류 (${res.status})` };
    }
    const json = await res.json();
    // ⚠️ 6-7: 응답은 바이너리가 아니라 base64 JSON이다.
    const b64 = json?.result?.image;
    if (!b64) return { ok: false, error: "이미지 생성 응답에 image 필드가 없습니다" };
    const buf = decodeGeneratedImage(b64);
    if (!buf) return { ok: false, error: "생성된 이미지가 너무 작습니다(생성 실패로 간주)" };
    return { ok: true, buffer: buf };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ③ 검증 — 크롤링용 판정 함수를 재사용하지 않는다.
export async function verifyGeneratedImage(imagePath: string, topic: string): Promise<GenVerdict> {
  const prompt = `이 AI 생성 이미지를 네이버 블로그 "${topic}" 글에 쓸 수 있는지 판정하라.
다음 네 가지만 본다 (워터마크·초상권은 생성 이미지에 해당 사항이 없으니 판정하지 않는다):
- topicMismatch: 글 주제와 이미지가 안 어울리면 true
- brokenShape: 사물/사람의 형태가 이상하게 깨져 있으면 true
- textArtifact: 이미지 안에 깨진 글자나 의미 없는 문자가 보이면 true
- lowQuality: 흐릿하거나 저품질이면 true
- reason: 판정 이유 한국어 한 문장

출력 형식: { "topicMismatch": boolean, "brokenShape": boolean, "textArtifact": boolean, "lowQuality": boolean, "reason": string }`;

  const res = await runClaudeJson(prompt, GenVerdictSchema, { images: [imagePath], retries: 1 });
  if (!res.ok) {
    return { topicMismatch: false, brokenShape: false, textArtifact: false, lowQuality: true, reason: `판정 실패: ${res.error}` };
  }
  return res.data;
}

// ── 오케스트레이션: 설계 → 생성 → 검증 → (실패 시 1회만 재시도) ──
export interface GenerateSectionImageInput {
  jobId: string;
  draftId: string;
  sectionIndex: number;
  title: string;
  caption?: string;
  contextBefore?: string;
  contextAfter?: string;
  style: ImageStyle;
  steps: number;
}

export async function generateSectionImage(
  input: GenerateSectionImageInput,
): Promise<{ path: string | null }> {
  const db = getDb();
  let retryReason: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const designed = await designImagePrompt({ ...input, retryReason });
    if (!designed.ok) {
      jobLog(input.jobId, "warn", `이미지 프롬프트 설계 실패: ${designed.error}`);
      break;
    }

    const generated = await callFluxSchnell(designed.prompt, input.steps);
    if (!generated.ok) {
      jobLog(input.jobId, "warn", `이미지 생성 실패: ${generated.error}`);
      // 생성 자체가 실패(키 없음/API 오류)했으면 재시도해도 소용없다.
      break;
    }

    const tmpPath = absDataPath("images", `${randomUUID()}.png`);
    fs.writeFileSync(tmpPath, generated.buffer);

    const verdict = await verifyGeneratedImage(tmpPath, input.title);
    if (genVerdictOk(verdict)) {
      const finalPath = absDataPath("images", `${randomUUID()}.png`);
      fs.renameSync(tmpPath, finalPath);
      db.prepare(
        `INSERT INTO images (id, job_id, draft_id, query, local_path, source_site, verdict_ok, verdict_reason, section_index, gen_prompt)
         VALUES (?, ?, ?, ?, ?, 'ai', 1, ?, ?, ?)`,
      ).run(randomUUID(), input.jobId, input.draftId, input.caption ?? "", finalPath, verdict.reason, input.sectionIndex, designed.prompt);
      return { path: finalPath };
    }

    fs.rmSync(tmpPath, { force: true });
    retryReason = verdict.reason;
    jobLog(input.jobId, "warn", `생성 이미지 부적합(${attempt + 1}차): ${verdict.reason}`);
  }

  // ⚠️ 6-7: 무한 루프 금지 — 최대 1회만 재생성하고, 그래도 실패하면 그 자리는 건너뛴다.
  jobLog(input.jobId, "warn", "이미지 생성을 포기하고 자리를 비웁니다");
  return { path: null };
}
