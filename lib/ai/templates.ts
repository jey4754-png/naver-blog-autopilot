import { runClaudeJson } from "@/lib/claude";
import { draftSchemaFor, type Draft, type PhotoSource } from "@/lib/types";
import { photoHintFor } from "@/lib/ai/content";

// ⚠️ 6-5: 두 유형(체험단·브랜딩) 모두 소제목을 heading 이 아니라 quote 로 만든다.
// 실제 상위 노출 블로그들의 문법이 그렇다. 짧은 한 줄(15~30자)로.
const HEADING_AS_QUOTE_RULE = `
소제목은 "heading" 타입이 아니라 "quote" 타입으로 만들어라 (실제 상위 노출 블로그들의 문법이다).
quote 는 15~30자의 짧은 한 줄이어야 한다. "heading" 타입은 절대 쓰지 마라.
문단은 2~4줄로 짧게 끊어라.
`;

const MARKDOWN_BAN = `
마크다운 기호(**, ~~, ~, #, >, 백틱, - 목록)를 절대 쓰지 마라. 네이버 에디터가 이를 자동으로 서식으로 바꿔버린다.
paragraph 섹션의 highlight 필드는 그 문단 text 안에 실제로 있는 문구만 글자 그대로 적어라. 지어내지 마라.
highlight는 문단당 최대 1개, 전체 문단의 약 30% 정도에만 붙여라.
`;

const OUTPUT_FORMAT = `
출력 형식: { "title": string, "sections": Section[] } 의 JSON 객체.
Section 은 다음 중 하나:
  { "type": "quote", "text": string }
  { "type": "paragraph", "text": string, "highlight"?: string }
  { "type": "divider" }
  { "type": "image", "query": string, "caption"?: string }
("heading" 타입은 쓰지 마라.)
`;

export interface TemplateOpts {
  photoSource: PhotoSource;
  photoCount: number;
  photoDescs?: string[];
}

function buildExperiencePrompt(topic: string, keyPoints: string, opts: TemplateOpts): string {
  return `주제: ${topic}
핵심 내용(사용자가 직접 겪은 정보):
${keyPoints}

이 글은 "체험단" 후기 글이다. 아래 규칙을 지켜라.
- 철저히 1인칭 시점으로 써라 ("저희는", "~했어요", "~더라구요").
- "ㅎㅎ", "진짜" 같은 구어체 표현을 자연스럽게 섞어라.
- 도입부에서 결론(총평)을 살짝 흘려라.
- 실용정보를 구획별로 나눠 써라: 가는 법 / 웨이팅 / 가격 / 언제 갈지 / 주의점 중 핵심 내용에 있는 것들.
- 문단 1~2개마다 사진 1장이 오는 리듬으로 배치하라.
- 마무리는 총평 + "다시 간다면"의 팁으로 끝내라.
${HEADING_AS_QUOTE_RULE}
${MARKDOWN_BAN}
사진 안내: ${photoHintFor(opts.photoSource, opts.photoCount, opts.photoDescs)}
${OUTPUT_FORMAT}`;
}

function buildBrandingPrompt(topic: string, keyPoints: string, opts: TemplateOpts): string {
  return `주제: ${topic}
핵심 내용(사용자가 준 사실·실적):
${keyPoints}

이 글은 "브랜딩·전문성" 글이다. "~입니다" 전문가체로 써라. 아래 구조를 고정으로 따라라.
① 권위 선점 (숫자 실적으로 시작)
② 독자의 문제/오해 짚기
③ 왜 흔한 방법이 안 통하는지
④ 이름 붙인 자체 프레임워크 제시
⑤ 예상되는 반박에 대한 Q&A
⑥ 정리 + 행동 유도(CTA)
구획이 바뀔 때 divider 를 1~2회 넣어라.
⚠️ 숫자·실적을 지어내지 마라. 반드시 위 "핵심 내용"에 있는 사실 안에서만 써라.
${HEADING_AS_QUOTE_RULE}
${MARKDOWN_BAN}
사진 안내: ${photoHintFor(opts.photoSource, opts.photoCount, opts.photoDescs)}
${OUTPUT_FORMAT}`;
}

async function runDraft(prompt: string, opts: TemplateOpts) {
  const schema = draftSchemaFor(opts.photoSource, opts.photoCount);
  const res = await runClaudeJson(prompt, schema, { retries: 2 });
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, draft: res.data as Draft };
}

export function generateExperienceDraft(topic: string, keyPoints: string, opts: TemplateOpts) {
  return runDraft(buildExperiencePrompt(topic, keyPoints, opts), opts);
}

export function generateBrandingDraft(topic: string, keyPoints: string, opts: TemplateOpts) {
  return runDraft(buildBrandingPrompt(topic, keyPoints, opts), opts);
}
