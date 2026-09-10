import fs from "node:fs";
import { newContext } from "@/lib/playwright";
import { paths } from "@/lib/paths";

// ⚠️ 2-4: 네이버 로그인은 자동화하지 않는다 (보안문자·2차인증). 창을 띄워 사용자가 직접
// 로그인하게 하고, NID_SES 쿠키가 생기면 storageState 를 저장해 재사용한다.

let loginInFlight = false;

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; reason: "already_running" | "timeout" | "closed" | "error" };

export async function loginInteractive(): Promise<LoginResult> {
  if (loginInFlight) {
    return { ok: false, error: "이미 로그인 창이 열려 있습니다", reason: "already_running" };
  }
  loginInFlight = true;
  try {
    const { browser, context } = await newContext({ headless: false, useNaverSession: false });
    const page = await context.newPage();
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });

    const deadline = Date.now() + 5 * 60 * 1000;
    let sessionFound = false;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        await browser.close().catch(() => {});
        return { ok: false, error: "로그인 창이 닫혔습니다", reason: "closed" };
      }
      const cookies = await context.cookies("https://.naver.com").catch(() => []);
      if (cookies.some((c) => c.name === "NID_SES")) {
        sessionFound = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!sessionFound) {
      await browser.close().catch(() => {});
      return { ok: false, error: "5분 안에 로그인이 완료되지 않았습니다", reason: "timeout" };
    }

    // 쿠키를 안정화한 뒤 저장한다.
    await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await context.storageState({ path: paths.naverSession });
    await browser.close().catch(() => {});

    invalidateSessionCache();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), reason: "error" };
  } finally {
    loginInFlight = false;
  }
}

export function isLoginInFlight(): boolean {
  return loginInFlight;
}

// ── 세션 검증 (7-9, 7-10) ─────────────────────────────────
// ⚠️ 7-9: naver.com 메인의 로그인 링크는 로그인 상태에서도 남아 있어 그걸로 판정하면
// 항상 "만료"로 나온다. blog.naver.com/MyBlog.naver 로 이동해 로그인 페이지로 튕기는지로 판정한다.
// ⚠️ 7-10: 읽기는 되는데 글쓰기만 만료된 상태가 있다("로그인 상태 유지" 미체크). 그래서
// 글쓰기 진입 페이지까지 한 번 더 열어봐야 한다.

export interface SessionCheck {
  valid: boolean;
  blogId?: string;
  reason?: string;
}

interface CacheEntry {
  result: SessionCheck;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateSessionCache() {
  cache = null;
}

export async function verifySession(opts?: { forceRefresh?: boolean }): Promise<SessionCheck> {
  if (!opts?.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  if (!fs.existsSync(paths.naverSession)) {
    const result: SessionCheck = { valid: false, reason: "저장된 로그인 정보가 없습니다" };
    cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }

  let browser;
  try {
    const ctx = await newContext({ headless: true, useNaverSession: true });
    browser = ctx.browser;
    const page = await ctx.context.newPage();

    // 1단계: 읽기 권한 (로그인 유지 여부)
    await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    let url = page.url();
    if (/nid\.naver\.com/.test(url)) {
      const result: SessionCheck = { valid: false, reason: "로그인이 만료되었습니다" };
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }
    const idMatch = url.match(/blog\.naver\.com\/([^/?]+)/);
    const blogId = idMatch?.[1];
    if (!blogId) {
      const result: SessionCheck = { valid: false, reason: "블로그 주소를 확인할 수 없습니다" };
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }

    // 2단계: 글쓰기 권한 (7-10) — 읽기는 되는데 쓰기만 만료된 상태가 실제로 있다.
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
    url = page.url();
    if (/nid\.naver\.com/.test(url)) {
      const result: SessionCheck = { valid: false, blogId, reason: "글쓰기 권한이 만료되었습니다" };
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }

    const result: SessionCheck = { valid: true, blogId };
    cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch (err) {
    const result: SessionCheck = {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
    cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } finally {
    await browser?.close().catch(() => {});
  }
}
