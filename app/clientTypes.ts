// 클라이언트 컴포넌트 전용 타입. lib/settings.ts 등 서버 전용 모듈(better-sqlite3 사용)을
// 브라우저 번들에 끌어들이지 않기 위해 타입만 여기 따로 둔다.

export interface Settings {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: "public" | "neighbor" | "both" | "private";
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
}

export interface RangeLimit {
  min: number;
  max: number;
}

export interface Limits {
  dailyPublishLimit: RangeLimit;
  minPublishIntervalMin: RangeLimit;
  scrapeTopN: RangeLimit;
  imageCandidates: RangeLimit;
  cfImageSteps: RangeLimit;
  claudeTimeoutSec: RangeLimit;
  claudeConcurrency: RangeLimit;
}

export interface StatusResponse {
  claude: { installed: boolean; version?: string; error?: string };
  naver: { valid: boolean; blogId?: string; reason?: string };
  cloudflareConfigured: boolean;
  settings: Settings;
  limits: Limits;
}

export interface UsageResponse {
  todayPublishCount: number;
  dailyPublishLimit: number;
  usage: { neurons: number; isEstimate: boolean; note?: string; freeDailyNeurons: number };
  neuronsPerImage: number;
}

export interface JobSummary {
  id: string;
  keyword: string;
  status: string;
  stage: string | null;
  mode: "auto" | "experience" | "branding";
  created_at: string;
  updated_at: string;
}

export type DraftSection =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; highlight?: string }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "image"; query: string; caption?: string };

export interface JobDetail {
  job: JobSummary & { inputs: string; error: string | null };
  ideas: { id: string; title: string; angle: string; rationale: string; chosen: number }[];
  drafts: { id: string; title: string; sections: DraftSection[] }[];
  images: {
    id: string;
    query: string;
    local_path: string | null;
    fileUrl: string | null;
    source_site: string;
    verdict_ok: number;
    verdict_reason: string | null;
    section_index: number | null;
  }[];
  posts: {
    id: string;
    status: string;
    blog_url: string | null;
    screenshot: string | null;
    screenshotUrl: string | null;
    note: string | null;
    published_at: string | null;
  }[];
}
