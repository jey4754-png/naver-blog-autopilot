import { z } from "zod";
import { runClaudeJson } from "@/lib/claude";
import { jobLog } from "@/lib/log";
import {
  IdeaListSchema,
  draftSchemaFor,
  type Draft,
  type DraftSection,
  type Idea,
  type PhotoSource,
  type ScrapedSource,
} from "@/lib/types";

// ── 수집 자료를 번호 매긴 텍스트 블록으로 압축 (6-5) ──────────
function formatSources(sources: ScrapedSource[]): string {
  return sources
    .map((s, i) => `[자료 ${i + 1}] (${s.type === "news" ? "뉴스" : "블로그"}) ${s.title}\n${s.summary.slice(0, 400)}`)
    .join("\n\n");
}

// ── 사진 소스별 안내문 (6-5) ──────────────────────────────
export function photoHintFor(
  photoSource: PhotoSource,
  count: number,
  descs?: string[],
): string {
  if (photoSource === "none") {
    return "사진은 쓰지 않는다. image 타입 섹션을 절대 만들지 마라.";
  }
  if (photoSource === "local") {
    const list = descs && descs.length > 0 ? descs.map((d, i) => `${i + 1}. ${d}`).join("\n") : "";
    return [
      `image 섹션을 정확히 ${count}개 만들어라. 더 만들거나 덜 만들지 마라.`,
      "image 섹션의 query 필드에는 검색어가 아니라 그 자리에 어떤 사진이 와야 하는지에 대한 설명을 적어라.",
      list ? `사용 가능한 사진 설명 목록(순서 참고용):\n${list}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (photoSource === "ai") {
    return "image 섹션의 query 필드에는 그 자리에 어떤 장면을 그려야 하는지 한국어로 구체적으로 묘사하라. 최소 6개 이상 배치하라.";
  }
  // crawl
  return "image 섹션의 query 필드에는 이미지 검색에 쓸 검색어를 적어라. 최소 6개 이상 배치하라.";
}

const COMMON_WRITING_RULES = `
지켜야 할 것:
- 수집 자료를 참고하되 문장을 그대로 베끼지 마라.
- 사람이 쓴 듯한 구어체로 쓰고, AI가 쓴 티가 나는 표현(따라서, 결론적으로, ~라고 할 수 있습니다 등)을 피하라.
- 전체 글 구조: 도입(공감/후킹) → 본문(소제목 2~4구획) → 마무리(요약/행동유도).
- 이미지 자리를 요구된 개수만큼 배치하라. 이미지 검색어/묘사는 사람 얼굴이 주인공이 아닌 사물·풍경·클로즈업·손동작 위주로 하라.
- 마크다운 기호(**, ~~, ~, #, >, 백틱, - 목록)를 절대 쓰지 마라. 네이버 에디터가 이를 자동으로 서식으로 바꿔버린다.
- paragraph 섹션의 highlight 필드는 그 문단 text 안에 실제로 있는 문구만 글자 그대로 적어라. 본문에 없는 문구를 지어내지 마라.
- highlight는 문단당 최대 1개, 전체 문단의 약 30% 정도에만 붙여라.

출력 형식: { "title": string, "sections": Section[] } 의 JSON 객체.
Section 은 다음 중 하나:
  { "type": "heading", "text": string }
  { "type": "paragraph", "text": string, "highlight"?: string }
  { "type": "quote", "text": string }
  { "type": "divider" }
  { "type": "image", "query": string, "caption"?: string }
`;

export async function generateIdeas(
  keyword: string,
  sources: ScrapedSource[],
  n = 5,
): Promise<{ ok: true; ideas: Idea[] } | { ok: false; error: string }> {
  const prompt = `키워드: ${keyword}

아래는 이 키워드로 수집한 최근 뉴스·블로그 자료다.
${formatSources(sources)}

위 자료를 참고해 네이버 블로그 글감 ${n}개를 제안하라.
각 글감은 title(제목 후보), angle(어떤 관점/각도로 쓸지), rationale(왜 지금 이 글감이 좋은지)을 포함한다.
출력 형식: [{ "title": string, "angle": string, "rationale": string }, ...] 의 JSON 배열.`;

  const res = await runClaudeJson(prompt, IdeaListSchema, { retries: 2 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, ideas: res.data };
}

export async function generateDraft(
  keyword: string,
  idea: Idea,
  sources: ScrapedSource[],
  opts: { photoSource: PhotoSource; photoCount: number; photoDescs?: string[] },
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }> {
  const prompt = `키워드: ${keyword}
선택된 글감: ${idea.title}
관점: ${idea.angle}
근거: ${idea.rationale}

참고 자료:
${formatSources(sources)}

${COMMON_WRITING_RULES}

사진 안내: ${photoHintFor(opts.photoSource, opts.photoCount, opts.photoDescs)}

위 글감으로 네이버 블로그 글 한 편을 작성하라.`;

  const schema = draftSchemaFor(opts.photoSource, opts.photoCount);
  const res = await runClaudeJson(prompt, schema, { retries: 2 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, draft: res.data as Draft };
}

// ⚠️ 7-24: AI가 본문에 없는 highlight 를 지어낸다(실측 5개 중 1개, 20%).
// highlight 는 text.indexOf(highlight) 로 자리를 찾으므로, 그대로 두면 서식이 엉뚱한
// 곳에 붙는다. 생성 직후 이 함수로 걸러내되, 초안 전체를 재생성시키지는 않는다
// (문단 30개짜리 글을 highlight 하나 때문에 버리는 건 나쁜 거래 — 생성에 100초가 든다).
export function sanitizeDraft(jobId: string, draft: Draft): Draft {
  let dropped = 0;
  const sections = draft.sections.map((s) => {
    if (s.type !== "paragraph" || !s.highlight) return s;
    if (s.text.includes(s.highlight)) return s;
    dropped++;
    const { highlight: _drop, ...rest } = s;
    return rest as typeof s;
  });
  if (dropped > 0) {
    jobLog(jobId, "warn", `본문에 없는 highlight ${dropped}개를 지어내 버렸습니다(자리 자체는 유지)`);
  }
  return { ...draft, sections };
}

// ── "AI로 다듬기" (발행 전 사용자가 화면에서 요청) ────────────
// ⚠️ 섹션의 개수·순서·타입은 절대 바꾸지 않는다. image 섹션은 이미 사진이 배정된
// 자리(section_index)와 연결되어 있어서, AI가 섹션을 추가/삭제/재배열하면 사진이
// 엉뚱한 자리로 밀린다. 그래서 글자가 있는 섹션(heading/paragraph/quote)의 text만
// 골라 인덱스와 함께 보내고, 돌아온 값을 같은 인덱스에만 되끼워 넣는다.
const PolishItemSchema = z.object({
  index: z.number().int().min(0),
  text: z.string().min(1),
  highlight: z.string().optional(),
});
const PolishResponseSchema = z.object({ items: z.array(PolishItemSchema) });

type TextBearingSection = Extract<DraftSection, { type: "heading" | "paragraph" | "quote" }>;

export async function polishDraftText(
  draft: Draft,
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }> {
  const editable = draft.sections
    .map((s, i) => ({ s: s as TextBearingSection, i }))
    .filter((x): x is { s: TextBearingSection; i: number } =>
      x.s.type === "heading" || x.s.type === "paragraph" || x.s.type === "quote",
    );

  if (editable.length === 0) return { ok: true, draft };

  const listing = editable.map(({ s, i }) => `${i} (${s.type}): ${s.text}`).join("\n");
  const prompt = `다음은 네이버 블로그 글의 문단·소제목·인용구들이다. 각 항목을 더 읽기 쉽게 다듬어라.
- 사실이나 숫자를 새로 지어내지 마라. 원문에 있는 내용만 자연스럽게 다듬는다.
- 문장을 짧게 끊고, 어색하거나 늘어지는 표현을 고쳐라. 전체적인 뜻과 어투(구어체/전문가체 등)는 유지하라.
- quote 항목은 15~30자의 짧은 한 줄을 유지하라.
- paragraph 항목의 highlight 는, 다듬은 뒤의 text 안에 실제로 있는 문구만 적어라. 강조할 게 마땅치 않으면 생략하라.
- 마크다운 기호(**, ~~, #, >, 백틱, - 목록)는 쓰지 마라.
- 반드시 아래 모든 index를 하나도 빠짐없이 포함해 응답하라.

${listing}

출력 형식: { "items": [{ "index": number, "text": string, "highlight"?: string }, ...] }`;

  const res = await runClaudeJson(prompt, PolishResponseSchema, { retries: 2 });
  if (!res.ok) return { ok: false, error: res.error };

  const byIndex = new Map(res.data.items.map((it) => [it.index, it]));
  const newSections = draft.sections.map((s, i) => {
    const patch = byIndex.get(i);
    if (!patch) return s;
    if (s.type === "paragraph") {
      const highlight = patch.highlight && patch.text.includes(patch.highlight) ? patch.highlight : undefined;
      return { ...s, text: patch.text, highlight };
    }
    if (s.type === "heading" || s.type === "quote") {
      return { ...s, text: patch.text };
    }
    return s;
  });

  return { ok: true, draft: { ...draft, sections: newSections } };
}
