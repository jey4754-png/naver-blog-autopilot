import { extractNews, extractBlog, type RawAnchor } from "@/lib/scrape/trends";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

// ⚠️ 7-1: help.naver.com/alias/news/... 가 /news/ 부분일치에 걸리는 문제
const newsAnchors: RawAnchor[] = [
  {
    href: "https://help.naver.com/alias/news/news_21.naver",
    text: "뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로 접수해주세요",
    containerText: "뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로 접수해주세요",
  },
  {
    href: "https://n.news.naver.com/mnews/article/001/0000000001",
    text: "제주도 여행객 급증, 올해만 300만명 넘어서",
    containerText:
      "제주도 여행객 급증, 올해만 300만명 넘어서 제주도를 찾는 여행객이 급증하고 있다. 올해 누적 방문객이 300만명을 넘어섰다고 관광공사가 밝혔다.",
  },
  // 같은 기사의 스니펫 링크(더 길고 문장형) — 제목 링크보다 나중에 나와도 제목 쪽이 남아야 한다
  {
    href: "https://n.news.naver.com/mnews/article/001/0000000001",
    text: "제주도를 찾는 여행객이 급증하고 있다. 올해 누적 방문객이 300만명을 넘어섰다고 관광공사가 밝혔다.",
    containerText: "제주도를 찾는 여행객이 급증하고 있다. 올해 누적 방문객이 300만명을 넘어섰다고 관광공사가 밝혔다.",
  },
  // 스크린리더용 보조 텍스트만 남은 항목 (11자라 길이 필터를 그냥 통과함 → 반드시 제거되어야 함)
  {
    href: "https://n.news.naver.com/mnews/article/001/0000000002",
    text: "네이버뉴스새 창 열림",
    containerText: "네이버뉴스새 창 열림",
  },
  {
    href: "https://n.news.naver.com/mnews/article/001/0000000003",
    text: "광고 더보기 바로가기",
    containerText: "광고 더보기 바로가기",
  },
];

const news = extractNews(newsAnchors, 8);
assert(!news.some((n) => n.url.includes("help.naver.com")), "help.naver.com 링크가 제외되었다");
assert(news.length === 1, `기사 1건만 남아야 한다 (실제 ${news.length}건: ${JSON.stringify(news.map((n) => n.title))})`);
assert(
  news[0]?.title === "제주도 여행객 급증, 올해만 300만명 넘어서",
  `짧은(제목) 쪽이 남아야 한다 (실제: "${news[0]?.title}")`,
);
assert(
  !news.some((n) => n.title.includes("새 창 열림") || n.title === "네이버뉴스"),
  "'새 창 열림' 보조 텍스트만 남은 항목은 제거되었다",
);

// ── 블로그: 홈 링크 vs 게시글 링크 ──────────────────────────
const blogAnchors: RawAnchor[] = [
  { href: "https://blog.naver.com/myblogid", text: "내 블로그 홈으로 이동", containerText: "내 블로그 홈으로 이동" },
  {
    href: "https://blog.naver.com/travelblogger/223456789012",
    text: "제주도 3박4일 완벽 코스 후기",
    containerText: "제주도 3박4일 완벽 코스 후기 렌트카부터 숙소까지 총정리했어요",
  },
];
const blog = extractBlog(blogAnchors, 8);
assert(blog.length === 1, `블로그 홈 링크는 제외되고 게시글만 남아야 한다 (실제 ${blog.length}건)`);
assert(blog[0]?.url.includes("223456789012") ?? false, "게시글 URL이 남아야 한다");

process.exit(process.exitCode ?? 0);
