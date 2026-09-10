import { newContext } from "@/lib/playwright";
import type { ScrapedSource } from "@/lib/types";

// ⚠️ 6-4: 네이버 검색 DOM은 자주 바뀌므로 셀렉터에 의존하지 않는다. page.evaluate 안에서
// 모든 a[href] 를 훑는 일반 추출로 구현한다. 추출(브라우저 안) 과 필터링(순수 함수)을
// 분리해두면 필터링 규칙은 계정·네트워크 없이 로컬 HTML로 재현·검증할 수 있다 (8-5, 9장 6.5-a 정신).

export interface RawAnchor {
  href: string;
  text: string;
  containerText: string;
}

// 브라우저 안에서 실행되는 함수. page.evaluate 에 그대로 전달한다.
export function extractRawAnchors(): RawAnchor[] {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  return anchors.map((a) => {
    const el = a as HTMLAnchorElement;
    const container = el.closest("li, div") as HTMLElement | null;
    return {
      href: el.href,
      text: el.textContent ?? "",
      containerText: container?.textContent ?? "",
    };
  });
}

const NOISE_TEXT = /광고|로그인|더보기|바로가기|언론사 선정|구독/;
const A11Y_NEW_WINDOW = /새\s*창\s*열림/g;

function cleanText(raw: string): string {
  return raw.replace(A11Y_NEW_WINDOW, "").trim();
}

function summarize(containerText: string, linkText: string): string {
  const idx = containerText.indexOf(linkText);
  const rest = idx >= 0 ? containerText.slice(0, idx) + containerText.slice(idx + linkText.length) : containerText;
  return rest.trim().slice(0, 260);
}

function dedupeByUrlPreferShorterTitle(items: ScrapedSource[]): ScrapedSource[] {
  const byUrl = new Map<string, ScrapedSource>();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing || item.title.length < existing.title.length) {
      byUrl.set(item.url, item);
    }
  }
  return Array.from(byUrl.values());
}

function dedupeByTitlePrefix(items: ScrapedSource[]): ScrapedSource[] {
  const seen = new Set<string>();
  const out: ScrapedSource[] = [];
  for (const item of items) {
    const key = item.title.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ⚠️ 6-4: help.naver.com/alias/news/... 가 /news/ 부분일치에 걸려 고객센터 안내문이
// AI 자료로 들어간다(실측). 반드시 help.naver.com / /alias/ 를 먼저 제외한다.
export function extractNews(anchors: RawAnchor[], topN: number): ScrapedSource[] {
  const items: ScrapedSource[] = [];
  for (const a of anchors) {
    if (/help\.naver\.com/.test(a.href) || /\/alias\//.test(a.href)) continue;
    if (!(/news\.naver\.com/.test(a.href) || /\/news\//.test(a.href) || /n\.news/.test(a.href))) continue;

    const text = cleanText(a.text);
    if (text.length < 8) continue;
    if (NOISE_TEXT.test(text)) continue;

    items.push({
      type: "news",
      title: text,
      summary: summarize(a.containerText, a.text),
      url: a.href,
    });
  }
  return dedupeByTitlePrefix(dedupeByUrlPreferShorterTitle(items)).slice(0, topN);
}

// 블로그 홈 링크(blog.naver.com/아이디)를 걸러내기 위해 게시글 패턴에 정확히 매칭시킨다.
const BLOG_POST_PATTERN = /^https?:\/\/blog\.naver\.com\/[^/]+\/\d{6,}(?:[/?#].*)?$/;

export function extractBlog(anchors: RawAnchor[], topN: number): ScrapedSource[] {
  const items: ScrapedSource[] = [];
  for (const a of anchors) {
    if (!BLOG_POST_PATTERN.test(a.href)) continue;

    const text = cleanText(a.text);
    if (text.length < 8) continue;
    if (NOISE_TEXT.test(text)) continue;

    items.push({
      type: "blog",
      title: text,
      summary: summarize(a.containerText, a.text),
      url: a.href,
    });
  }
  return dedupeByTitlePrefix(dedupeByUrlPreferShorterTitle(items)).slice(0, topN);
}

export async function scrapeTrends(keyword: string, topN: number): Promise<ScrapedSource[]> {
  const { browser, context } = await newContext({ headless: true, useNaverSession: false });
  try {
    const page = await context.newPage();

    await page.goto(
      `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}&sort=1`,
      { waitUntil: "domcontentloaded" },
    );
    const newsAnchors = await page.evaluate(extractRawAnchors);
    const news = extractNews(newsAnchors, topN);

    await page.goto(`https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`, {
      waitUntil: "domcontentloaded",
    });
    const blogAnchors = await page.evaluate(extractRawAnchors);
    const blog = extractBlog(blogAnchors, topN);

    return [...news, ...blog];
  } finally {
    await browser.close().catch(() => {});
  }
}
