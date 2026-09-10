// 전역 기본값. 이후로는 lib/settings.ts 를 거쳐 DB 값이 우선한다.
// 여기 값은 "DB에 아직 아무 설정도 없을 때"의 최초 기본값일 뿐이다.

export const DEFAULTS = {
  dryRun: true,
  killSwitch: false,
  visibility: "private" as const,
  dailyPublishLimit: 3,
  minPublishIntervalMin: 30,
  scrapeTopN: 8,
  imageCandidates: 10,
  cfImageSteps: 6,
  showBrowser: false,
  claudeTimeoutSec: 180,
  claudeConcurrency: 2,
};

export const LIMITS = {
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
};

export const VISIBILITY_VALUES = ["public", "neighbor", "both", "private"] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

export const PORT = 4123;
