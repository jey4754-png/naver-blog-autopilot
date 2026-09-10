import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { expandHome } from "@/lib/paths";
import { runClaudeJson } from "@/lib/claude";
import type { LocalPhotoDesc } from "@/lib/types";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

// 6-8: 폴더를 읽어 사진만, 파일명 자연순 정렬. 사용자가 직접 찍은 사진이므로
// 워터마크·초상권 필터를 적용하지 않는다.
export function listLocalPhotos(folder: string): string[] {
  const dir = expandHome(folder);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && PHOTO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
    .map((name) => path.join(dir, name));
}

// 사진 설명은 본문 생성 전에 한 번만 만들고 그 결과를 재사용해야 한다 (6-8, 6-10 경고).
// 이 함수를 두 번 부르면 claude 호출이 배로 든다 — 호출부에서 결과를 캐싱해서 넘겨야 한다.
export async function describeLocalPhotos(photos: string[]): Promise<LocalPhotoDesc[]> {
  const results: LocalPhotoDesc[] = [];
  const schema = z.object({ desc: z.string().min(1) });
  for (const p of photos) {
    const res = await runClaudeJson(
      "이 사진을 30자 이내 한국어 한 줄로 설명하라. 무엇이 찍혀 있는지 구체적으로. 출력 형식: { \"desc\": string }",
      schema,
      { images: [p], retries: 1 },
    );
    results.push({ path: p, desc: res.ok ? res.data.desc.slice(0, 30) : "(설명 생성 실패)" });
  }
  return results;
}

export type PhotoBatchMode = "order" | "ai";

// 사진마다 만든 설명과 각 자리의 캡션(또는 설명)을 매칭한다.
// 매칭에 실패하면(호출 실패·형식 오류·개수 불일치) 순서대로 채우는 폴백을 반드시 둔다.
export async function matchPhotosToCaptions(
  descs: LocalPhotoDesc[],
  captions: string[],
  mode: PhotoBatchMode,
): Promise<string[]> {
  const sequentialFallback = () => descs.slice(0, captions.length).map((d) => d.path);

  if (mode === "order" || descs.length === 0) {
    return sequentialFallback();
  }

  const prompt = `사진 설명 목록 (인덱스, 설명):
${descs.map((d, i) => `${i}: ${d.desc}`).join("\n")}

글의 사진 자리 설명 목록 (순서대로):
${captions.map((c, i) => `${i}: ${c}`).join("\n")}

각 "사진 자리"에 가장 잘 어울리는 사진의 인덱스를 순서대로 배정하라. 각 사진은 최대 한 번만 쓸 수 있다.
출력 형식: { "assignment": number[] } — 배열 길이는 사진 자리 개수(${captions.length})와 같아야 하고, 값은 사진 인덱스(0~${descs.length - 1})다.`;

  const schema = z.object({ assignment: z.array(z.number().int().min(0).max(descs.length - 1)) });
  const res = await runClaudeJson(prompt, schema, { retries: 1 });

  if (!res.ok) return sequentialFallback();
  const { assignment } = res.data;
  if (assignment.length !== captions.length) return sequentialFallback();
  if (new Set(assignment).size !== assignment.length) return sequentialFallback(); // 중복 배정 방지

  return assignment.map((idx) => descs[idx]!.path);
}
