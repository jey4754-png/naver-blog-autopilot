import fs from "node:fs";
import type { Page, FrameLocator, Locator } from "playwright";
import { newContext } from "@/lib/playwright";
import { getSettings } from "@/lib/settings";
import { getDb } from "@/lib/db";
import { jobLog } from "@/lib/log";
import { absDataPath } from "@/lib/paths";
import { EDITOR, type VisibilityKey } from "@/lib/scrape/selectors";
import { sanitizeMarkdown, typeSafely } from "@/lib/naver/textSafety";
import type { Draft, DraftSection } from "@/lib/types";

type Scope = Page | FrameLocator;

// ────────────────────────────────────────────────────────────
// 공용 DOM 헬퍼
// ────────────────────────────────────────────────────────────

// 후보 배열 중 위에서부터 isVisible 인 첫 번째를 반환한다.
async function firstVisible(scope: Scope, selectors: readonly string[], timeout = 800): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = scope.locator(sel).first();
    try {
      const count = await loc.count();
      if (count === 0) continue;
      const visible = await loc.isVisible({ timeout }).catch(() => false);
      if (visible) return loc;
    } catch {
      // 다음 후보로.
    }
  }
  return null;
}

// ⚠️ 7-27: boundingBox() 는 요소가 없으면 기본 30초를 기다린다. 반드시 timeout 을 주고,
// 같은 값을 반복해 재지 말고 한 번 재서 재사용한다.
async function boxOf(locator: Locator, timeout = 800) {
  try {
    return await locator.boundingBox({ timeout });
  } catch {
    return null;
  }
}

// ⚠️ 6-9: 발행 버튼·공개범위 라디오의 위치(iframe 안/밖)는 환경마다 다르다.
// iframe 안 → 바깥 문서 순으로 반드시 둘 다 뒤진다.
async function clickAnywhere(
  page: Page,
  frame: FrameLocator,
  selectors: readonly string[],
  timeout = 800,
): Promise<Locator | null> {
  const inFrame = await firstVisible(frame, selectors, timeout);
  if (inFrame) {
    await inFrame.click();
    return inFrame;
  }
  const inPage = await firstVisible(page, selectors, timeout);
  if (inPage) {
    await inPage.click();
    return inPage;
  }
  return null;
}

async function findAnywhere(
  page: Page,
  frame: FrameLocator,
  selectors: readonly string[],
  timeout = 800,
): Promise<Locator | null> {
  const inFrame = await firstVisible(frame, selectors, timeout);
  if (inFrame) return inFrame;
  return firstVisible(page, selectors, timeout);
}

// ── 오버레이 닫기 ──────────────────────────────────────────

// ⚠️ 7-1, 7-3: '취소' 텍스트는 팝업 안으로 스코프 + 정확일치로만 찾는다.
// 클래스 기반 셀렉터를 먼저 시도한다.
async function closeRestorePopup(frame: FrameLocator, jobId: string): Promise<boolean> {
  const popup = await firstVisible(frame, EDITOR.restorePopup, 1500);
  if (!popup) return true; // 팝업 자체가 없으면 통과.

  for (const sel of EDITOR.restoreCancel) {
    const btn = frame.locator(sel).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (!(await btn.isVisible({ timeout: 800 }).catch(() => false))) continue;
    await btn.click().catch(() => {});
    const gone = await popup.isHidden({ timeout: 2000 }).catch(() => false);
    if (gone) {
      jobLog(jobId, "info", "이전 작성 글 복원 팝업을 '취소'로 닫았습니다");
      return true;
    }
  }
  jobLog(jobId, "error", "이전 작성 글 복원 팝업을 닫지 못했습니다");
  return false;
}

// ⚠️ 7-4, 7-21: 도움말/온보딩 패널과 우측 라이브러리 도크는 클래스 계열이 환경마다 다르다.
// 두 계열 모두 시도하고, 안 되면 Escape.
async function closeOverlays(frame: FrameLocator, page: Page): Promise<void> {
  const help = await firstVisible(frame, EDITOR.helpClose, 500);
  if (help) {
    await help.click().catch(() => {});
    return;
  }
  const sidebar = await firstVisible(frame, EDITOR.sidebarClose, 500);
  if (sidebar) {
    await sidebar.click().catch(() => {});
    return;
  }
  await page.keyboard.press("Escape").catch(() => {});
}

// ⚠️ 7-5, 7-6, 7-27: 컴포넌트(인용구/구분선/캡션) 다음 문단으로 빠져나가려면 마우스로
// 마지막 컴포넌트 아래 빈 영역을 클릭해야 한다. 하단 글감 검색바 위치를 실측해 y좌표를
// 클램프한다.
async function escapeClickBelow(frame: FrameLocator, page: Page): Promise<void> {
  const last = frame.locator(EDITOR.contentComponents[0]).last();
  const lbox = await boxOf(last);
  const toolbarBox = await boxOf(frame.locator(EDITOR.bottomToolbar[0]).first());

  const viewport = page.viewportSize();
  const vh = viewport?.height ?? 900;
  const canvasBottom = vh;

  let y = lbox ? lbox.y + lbox.height + 30 : vh - 200;
  const maxY = Math.min(toolbarBox ? toolbarBox.y - 20 : vh - 150, canvasBottom - 20);

  if (y > maxY) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(150);
    y = Math.max(140, Math.min(y, maxY));
  } else {
    y = Math.max(140, y);
  }

  const x = lbox ? lbox.x + Math.min(40, lbox.width / 2) : 200;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}

// ────────────────────────────────────────────────────────────
// 섹션별 입력
// ────────────────────────────────────────────────────────────

async function openTextFormat(frame: FrameLocator): Promise<void> {
  const btn = await firstVisible(frame, EDITOR.textFormatOpen);
  if (btn) {
    await btn.click();
    await frame.locator("body").page().waitForTimeout(300); // 드롭다운 애니메이션 대기
  }
}

async function typeHeading(frame: FrameLocator, page: Page, text: string): Promise<void> {
  await openTextFormat(frame);
  const opt = await firstVisible(frame, EDITOR.optHeading);
  await opt?.click();
  await page.waitForTimeout(300);
  await typeSafely(page, sanitizeMarkdown(text));
  await page.keyboard.press("Enter");
  await openTextFormat(frame);
  const back = await firstVisible(frame, EDITOR.optBody);
  await back?.click();
  await page.waitForTimeout(300);
}

async function typeParagraph(
  frame: FrameLocator,
  page: Page,
  section: Extract<DraftSection, { type: "paragraph" }>,
): Promise<void> {
  const text = sanitizeMarkdown(section.text);
  // ⚠️ 7-24: 타이핑 직전에도 한 번 더 확인한다(이중 방어). 원문 text 기준으로 찾되,
  // 마크다운 무력화로 문구가 미세하게 달라졌을 수 있어 원본 text 로 위치를 잡는다.
  const highlight = section.highlight && section.text.includes(section.highlight) ? section.highlight : null;

  if (!highlight) {
    await typeSafely(page, text);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    return;
  }

  const idx = section.text.indexOf(highlight);
  const before = sanitizeMarkdown(section.text.slice(0, idx));
  const mid = sanitizeMarkdown(highlight);
  const after = sanitizeMarkdown(section.text.slice(idx + highlight.length));

  await typeSafely(page, before);

  const boldBtn = await firstVisible(frame, EDITOR.bold);
  const bgOpen = await firstVisible(frame, EDITOR.bgColorOpen);
  await boldBtn?.click();
  await page.waitForTimeout(250);
  await bgOpen?.click();
  await page.waitForTimeout(250);
  const yellow = await firstVisible(frame, EDITOR.bgColorYellow);
  await yellow?.click();
  await page.waitForTimeout(250);

  await typeSafely(page, mid);

  const bgOpen2 = await firstVisible(frame, EDITOR.bgColorOpen);
  await bgOpen2?.click();
  await page.waitForTimeout(250);
  const noColor = await firstVisible(frame, EDITOR.bgColorNone);
  await noColor?.click();
  await page.waitForTimeout(250);
  const boldBtn2 = await firstVisible(frame, EDITOR.bold);
  await boldBtn2?.click();
  await page.waitForTimeout(250);

  await typeSafely(page, after);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
}

async function typeQuote(frame: FrameLocator, page: Page, text: string): Promise<void> {
  await typeSafely(page, sanitizeMarkdown(text));
  await page.keyboard.press("Shift+Home");
  await openTextFormat(frame);
  const opt = await firstVisible(frame, EDITOR.optQuote);
  await opt?.click();
  await page.waitForTimeout(300);
  // ⚠️ 7-5: 인용구 컴포넌트 안에서는 어떤 키로도 탈출되지 않는다. 마우스 클릭만 통한다.
  await escapeClickBelow(frame, page);
}

async function typeDivider(frame: FrameLocator, page: Page): Promise<void> {
  const btn = await firstVisible(frame, EDITOR.dividerInsert);
  await btn?.click();
  await page.waitForTimeout(300);
  await escapeClickBelow(frame, page);
}

// ── 이미지 업로드 (7-7: 영구 filechooser 핸들러) ────────────
interface PendingUpload {
  path: string | null;
  done: boolean;
}

function registerFileChooserHandler(page: Page, pending: PendingUpload): void {
  page.on("filechooser", async (chooser) => {
    try {
      if (pending.path) await chooser.setFiles(pending.path);
    } finally {
      pending.done = true;
    }
  });
}

async function waitUploadDone(pending: PendingUpload, page: Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pending.done) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// ⚠️ 7-18: 캡션 칸은 업로드 직후 크기가 0×0 이다. 이미지 컴포넌트를 먼저 클릭해야
// 펼쳐진다(se-is-on 클래스 확인). el.focus() 로 우회하면 글자가 사라진다.
async function insertImageWithCaption(
  frame: FrameLocator,
  page: Page,
  pending: PendingUpload,
  jobId: string,
  imagePath: string,
  caption?: string,
): Promise<void> {
  pending.path = imagePath;
  pending.done = false;

  const imgBtn = await firstVisible(frame, EDITOR.imageButton);
  if (!imgBtn) {
    jobLog(jobId, "error", "이미지 삽입 버튼을 찾지 못했습니다");
    return;
  }
  await imgBtn.click();

  const uploaded = await waitUploadDone(pending, page);
  if (!uploaded) {
    jobLog(jobId, "error", "이미지 업로드가 20초 안에 끝나지 않았습니다");
    return;
  }
  await page.waitForTimeout(2600);

  if (!caption) return;

  const lastImage = frame.locator(EDITOR.imageComponent[0]).last();
  if ((await lastImage.count().catch(() => 0)) === 0) {
    jobLog(jobId, "warn", "업로드된 이미지 컴포넌트를 찾지 못해 캡션을 건너뜁니다");
    return;
  }
  await lastImage.click().catch(() => {});
  await page.waitForTimeout(400);

  const captionLoc = lastImage.locator(EDITOR.caption[0]);
  const expanded = await captionLoc
    .first()
    .evaluate((el) => el.classList.contains("se-is-on"), undefined, { timeout: 1500 })
    .catch(() => false);

  if (!expanded) {
    // ⚠️ 폴백 사다리 ②: 캡션을 포기하고 경고 로그만 남긴다. 본문에 그냥 타이핑하면
    // 사진 설명이 아니라 본문 줄이 되어 다음 문단과 합쳐지므로, 넣는 것보다 빼는 게 낫다.
    jobLog(jobId, "warn", "캡션 칸이 펼쳐지지 않아 캡션 입력을 건너뜁니다(이미지 자체는 유지)");
    return;
  }

  await captionLoc.first().click().catch(() => {});
  await page.waitForTimeout(200);
  await typeSafely(page, sanitizeMarkdown(caption));
  // 캡션도 컴포넌트 안이므로 7-5와 같은 마우스 탈출이 필요하다.
  await escapeClickBelow(frame, page);
}

async function typeSection(
  frame: FrameLocator,
  page: Page,
  pending: PendingUpload,
  jobId: string,
  section: DraftSection,
  imagePath: string | undefined,
  headingAsQuote: boolean,
): Promise<void> {
  if (section.type === "heading") {
    if (headingAsQuote) {
      await typeQuote(frame, page, section.text);
    } else {
      await typeHeading(frame, page, section.text);
    }
    return;
  }
  if (section.type === "paragraph") {
    await typeParagraph(frame, page, section);
    return;
  }
  if (section.type === "quote") {
    await typeQuote(frame, page, section.text);
    return;
  }
  if (section.type === "divider") {
    await typeDivider(frame, page);
    return;
  }
  if (section.type === "image") {
    if (!imagePath) {
      jobLog(jobId, "warn", `"${section.query}" 자리에 쓸 사진이 없어 건너뜁니다`);
      return;
    }
    await insertImageWithCaption(frame, page, pending, jobId, imagePath, section.caption);
    // ⚠️ 7-21: 사진을 넣으면 우측 도크가 열려 본문을 덮는다. 다음 입력 전에 닫는다.
    await closeOverlays(frame, page);
  }
}

// ────────────────────────────────────────────────────────────
// 스크린샷 (7-20)
// ────────────────────────────────────────────────────────────

async function takeFullScreenshot(page: Page, frame: FrameLocator, destPath: string, jobId: string): Promise<void> {
  const original = page.viewportSize() ?? { width: 1366, height: 900 };
  const content = frame.locator(".se-content").first();

  try {
    const contentBox = await boxOf(content, 1500);
    const scrollHeight = await content
      .evaluate((el) => el.scrollHeight, undefined, { timeout: 1500 })
      .catch(() => null);

    if (contentBox && scrollHeight) {
      // ⚠️ 7-20: boundingBox().height 로 계산하지 마라 — 실측 761 vs 3637, 5배 차이.
      const newHeight = Math.min(9000, Math.round(contentBox.y + scrollHeight + 160));
      await page.setViewportSize({ width: original.width, height: newHeight });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: destPath, fullPage: true });
    } else {
      jobLog(jobId, "warn", "본문 높이를 읽지 못해 화면에 보이는 부분만 저장합니다(스크린샷이 일부만 담겼을 수 있습니다)");
      await page.screenshot({ path: destPath, fullPage: true });
    }
  } finally {
    await page.setViewportSize(original);
  }
}

// ────────────────────────────────────────────────────────────
// 공개 범위 (7-19)
// ────────────────────────────────────────────────────────────

async function selectVisibility(page: Page, frame: FrameLocator, visibility: VisibilityKey): Promise<boolean> {
  const target = EDITOR.visibility[visibility];
  const label = await findAnywhere(page, frame, [target.label], 1500);
  if (!label) return false;
  await label.click().catch(() => {});
  await page.waitForTimeout(300);

  const input = await findAnywhere(page, frame, [target.input], 1000);
  if (!input) return false;

  const checked = await input.isChecked({ timeout: 1000 }).catch(() => false);
  return checked;
}

// ────────────────────────────────────────────────────────────
// 발행 검증 (7-11)
// ────────────────────────────────────────────────────────────

const PUBLISHED_URL_PATTERN = /blog\.naver\.com\/[^/]+\/\d{6,}/;

async function waitForPublishedUrl(page: Page, timeoutMs = 20_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (PUBLISHED_URL_PATTERN.test(url)) return url;
    await page.waitForTimeout(500);
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 발행 가드 (kill-switch / 하루 한도 / 최소 간격)
// ────────────────────────────────────────────────────────────

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

// ⚠️ 7-22: datetime('now') 는 UTC다. 하루 집계는 로컬 날짜 기준이어야 한다.
export function checkPublishGuards(): GuardResult {
  const settings = getSettings();
  if (settings.killSwitch) {
    return { blocked: true, reason: "전체 중단(kill-switch)이 켜져 있습니다" };
  }

  const db = getDb();
  const todayCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts
       WHERE status = 'published' AND date(published_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  if (todayCount.n >= settings.dailyPublishLimit) {
    return { blocked: true, reason: `오늘 발행 한도(${settings.dailyPublishLimit}편)에 도달했습니다` };
  }

  const last = db
    .prepare(`SELECT published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`)
    .get() as { published_at: string } | undefined;
  if (last?.published_at) {
    const elapsedMin = (Date.now() - new Date(last.published_at + "Z").getTime()) / 60000;
    if (elapsedMin < settings.minPublishIntervalMin) {
      return {
        blocked: true,
        reason: `마지막 발행 후 ${Math.ceil(settings.minPublishIntervalMin - elapsedMin)}분을 더 기다려야 합니다`,
      };
    }
  }

  return { blocked: false };
}

// ────────────────────────────────────────────────────────────
// 메인 오케스트레이션
// ────────────────────────────────────────────────────────────

export interface PublishOptions {
  jobId: string;
  draftId: string;
  draft: Draft;
  blogId?: string;
  headingAsQuote?: boolean;
  imagePaths?: Map<number, string>; // section index -> local image path
  // 9장 6.5-a 로컬 하네스 전용. 실제 사용자 코드 경로는 절대 이 값을 설정하지 않는다.
  testEntryUrl?: string;
  // 하네스가 브라우저를 닫기 전에 페이지 상태(window.__harness 등)를 읽을 수 있게 하는
  // 테스트 전용 훅. 프로덕션 경로에서는 절대 설정하지 않는다.
  testHooks?: { beforeClose?: (page: Page) => void | Promise<void> };
}

export interface PublishResult {
  status: "dry_run" | "published" | "failed" | "blocked";
  blogUrl?: string;
  screenshot?: string;
  note: string;
}

export async function publishToNaver(opts: PublishOptions): Promise<PublishResult> {
  const settings = getSettings();
  const isHarness = Boolean(opts.testEntryUrl);

  if (!settings.dryRun && !isHarness) {
    const guard = checkPublishGuards();
    if (guard.blocked) {
      jobLog(opts.jobId, "warn", `발행이 차단되었습니다: ${guard.reason}`);
      return { status: "blocked", note: guard.reason ?? "발행이 차단되었습니다" };
    }
  }

  if (!opts.blogId && !isHarness) {
    return { status: "failed", note: "블로그 주소를 확인할 수 없습니다(로그인 필요)" };
  }

  const { browser, context } = await newContext({
    headless: isHarness ? true : !settings.showBrowser,
    useNaverSession: !isHarness,
  });

  const pending: PendingUpload = { path: null, done: false };
  let page: Page | undefined;

  try {
    page = await context.newPage();
    // ⚠️ 7-7: 페이지를 열기 전에 영구 핸들러를 등록한다. 일회성 리스너가 만료된 뒤
    // 이미지 버튼을 누르면 OS 네이티브 파일 대화상자가 떠서 브라우저가 영구히 멈춘다.
    registerFileChooserHandler(page, pending);

    const entryUrl = opts.testEntryUrl ?? `https://blog.naver.com/${opts.blogId}?Redirect=Write&categoryNo=0`;
    await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const frame = page.frameLocator(EDITOR.frame);

    const popupOk = await closeRestorePopup(frame, opts.jobId);
    if (!popupOk) {
      const shot = absDataPath("screenshots", `${opts.jobId}-popup-fail.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      return { status: "failed", screenshot: shot, note: "이전 글 복원 팝업을 닫지 못해 중단했습니다" };
    }

    await closeOverlays(frame, page);

    // ── 제목 ──
    const titleEl = await firstVisible(frame, EDITOR.title, 3000);
    if (!titleEl) {
      const shot = absDataPath("screenshots", `${opts.jobId}-title-fail.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      return { status: "failed", screenshot: shot, note: "제목 입력 칸을 찾지 못해 중단했습니다" };
    }
    await titleEl.click();
    await typeSafely(page, sanitizeMarkdown(opts.draft.title));

    // ── 본문 진입 ──
    // ⚠️ 7-26: 본문을 못 찾았을 때 조용히 Enter로 넘어가면 글 전체가 제목 칸에 들어간다.
    // Enter로 한 번 더 시도하고, 그래도 안 되면 반드시 실패 처리한다.
    let bodyEl = await firstVisible(frame, EDITOR.body, 2000);
    if (!bodyEl) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      bodyEl = await firstVisible(frame, EDITOR.body, 2000);
    }
    if (!bodyEl) {
      const shot = absDataPath("screenshots", `${opts.jobId}-body-fail.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      jobLog(opts.jobId, "error", "본문 영역을 찾지 못했습니다 — 제목 칸에 전부 들어갔을 수 있어 중단합니다");
      return { status: "failed", screenshot: shot, note: "본문 입력 칸을 찾지 못해 중단했습니다" };
    }
    await bodyEl.click();

    // ── 섹션 순차 입력 ──
    for (let i = 0; i < opts.draft.sections.length; i++) {
      const section = opts.draft.sections[i]!;
      const imagePath = opts.imagePaths?.get(i);
      await typeSection(frame, page, pending, opts.jobId, section, imagePath, opts.headingAsQuote ?? false);
    }

    // ⚠️ 7-4, 7-21: 스크린샷 앞에 한 번 닫는다.
    await closeOverlays(frame, page);

    const screenshotPath = absDataPath("screenshots", `${opts.jobId}-preview.png`);
    await takeFullScreenshot(page, frame, screenshotPath, opts.jobId);

    if (settings.dryRun) {
      jobLog(opts.jobId, "info", "연습 모드이므로 여기서 종료합니다(발행하지 않음)");
      return { status: "dry_run", screenshot: screenshotPath, note: "연습 모드로 완성 화면만 저장했습니다" };
    }

    // ⚠️ 7-21: 스크린샷 뒤에도 다시 한 번 닫는다 — 스크린샷 이후 재차 열렸을 수 있다.
    await closeOverlays(frame, page);

    const publishBtn = await clickAnywhere(page, frame, EDITOR.publishOpen, 1500);
    if (!publishBtn) {
      return { status: "failed", screenshot: screenshotPath, note: "발행 버튼을 찾지 못해 중단했습니다" };
    }
    await page.waitForTimeout(800);

    // ⚠️ 7-19: 확인되지 않으면 절대 발행하지 않는다 — 네이버 기본값은 전체공개다.
    const visConfirmed = await selectVisibility(page, frame, settings.visibility);
    if (!visConfirmed) {
      jobLog(opts.jobId, "error", "공개 범위를 확인할 수 없어 발행을 중단했습니다");
      return {
        status: "failed",
        screenshot: screenshotPath,
        note: "공개 범위를 확인할 수 없어 중단했습니다(글은 임시저장 상태로 남아 있을 수 있습니다)",
      };
    }

    const confirmBtn = await clickAnywhere(page, frame, EDITOR.publishConfirm, 1500);
    if (!confirmBtn) {
      return { status: "failed", screenshot: screenshotPath, note: "최종 확인 버튼을 찾지 못해 중단했습니다" };
    }

    // ⚠️ 7-11: 발행 버튼을 눌렀다는 사실이 발행됐다는 뜻은 아니다. URL로 확정한다.
    const publishedUrl = await waitForPublishedUrl(page);
    if (!publishedUrl) {
      return {
        status: "failed",
        screenshot: screenshotPath,
        note: "발행 확인이 되지 않았습니다. 글은 임시저장 상태로 남아 있을 수 있습니다",
      };
    }

    return { status: "published", blogUrl: publishedUrl, screenshot: screenshotPath, note: "정상적으로 발행되었습니다" };
  } finally {
    if (page && opts.testHooks?.beforeClose) {
      await Promise.resolve(opts.testHooks.beforeClose(page)).catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}
