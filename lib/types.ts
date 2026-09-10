import { z } from "zod";

// ── 글 작성 유형 ──────────────────────────────────────────────
export const WriteModeSchema = z.enum(["auto", "experience", "branding"]);
export type WriteMode = z.infer<typeof WriteModeSchema>;

export const PhotoSourceSchema = z.enum(["local", "crawl", "ai", "none"]);
export type PhotoSource = z.infer<typeof PhotoSourceSchema>;

export const ImageStyleSchema = z.enum(["photo", "illust"]);
export type ImageStyle = z.infer<typeof ImageStyleSchema>;

// ── 글감 (자동 발굴 모드) ──────────────────────────────────────
export const IdeaSchema = z.object({
  title: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const IdeaListSchema = z.array(IdeaSchema).min(1);

// ── 본문 섹션 (6-5: 글은 문자열이 아니라 섹션 배열) ─────────────
export const HeadingSectionSchema = z.object({
  type: z.literal("heading"),
  text: z.string().min(1),
});

export const ParagraphSectionSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
  highlight: z.string().optional(),
});

export const QuoteSectionSchema = z.object({
  type: z.literal("quote"),
  text: z.string().min(1),
});

export const DividerSectionSchema = z.object({
  type: z.literal("divider"),
});

export const ImageSectionSchema = z.object({
  type: z.literal("image"),
  query: z.string().min(1),
  caption: z.string().optional(),
});

export const DraftSectionSchema = z.discriminatedUnion("type", [
  HeadingSectionSchema,
  ParagraphSectionSchema,
  QuoteSectionSchema,
  DividerSectionSchema,
  ImageSectionSchema,
]);
export type DraftSection = z.infer<typeof DraftSectionSchema>;

function countImageSections(sections: DraftSection[]): number {
  return sections.filter((s) => s.type === "image").length;
}

const BaseDraftSchema = z.object({
  title: z.string().min(1),
  sections: z.array(DraftSectionSchema).min(1),
});

// ⚠️ 6-5: 이미지 섹션 개수 강제는 소스별로 분기해야 한다.
// crawl/ai는 넉넉히(6+), local은 사진 장수만큼 정확히, none은 0개.
// 모든 모드에 6개 이상을 강제하면 local 모드(사진 4장뿐인 경우)가 재시도만 반복하다 실패한다.
export function draftSchemaFor(photoSource: PhotoSource, localPhotoCount?: number) {
  if (photoSource === "crawl" || photoSource === "ai") {
    return BaseDraftSchema.refine((d) => countImageSections(d.sections) >= 6, {
      message: "이미지 섹션이 6개 미만입니다",
    });
  }
  if (photoSource === "local") {
    const n = localPhotoCount ?? 0;
    return BaseDraftSchema.refine((d) => countImageSections(d.sections) === n, {
      message: `이미지 섹션이 사진 장수(${n})와 일치하지 않습니다`,
    });
  }
  // none
  return BaseDraftSchema.refine((d) => countImageSections(d.sections) === 0, {
    message: "사진 없음 모드인데 이미지 섹션이 있습니다",
  });
}

export type Draft = z.infer<typeof BaseDraftSchema>;

// ── 크롤링 이미지 비전 판정 (6-6) ────────────────────────────
export const VisionVerdictSchema = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string(),
});
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>;

// ── AI 생성 이미지 검증 (6-7, 7-13: 크롤링용 판정과 분리) ──────
export const GenVerdictSchema = z.object({
  topicMismatch: z.boolean(),
  brokenShape: z.boolean(),
  textArtifact: z.boolean(),
  lowQuality: z.boolean(),
  reason: z.string(),
});
export type GenVerdict = z.infer<typeof GenVerdictSchema>;

export function genVerdictOk(v: GenVerdict): boolean {
  return !v.topicMismatch && !v.brokenShape && !v.textArtifact && !v.lowQuality;
}

// ── 수집 자료 (6-4) ────────────────────────────────────────
export interface ScrapedSource {
  type: "news" | "blog";
  title: string;
  summary: string;
  url: string;
}

// ── 로컬 사진 설명 ──────────────────────────────────────────
export interface LocalPhotoDesc {
  path: string;
  desc: string;
}
