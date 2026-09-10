import { generateIdeas, generateDraft, sanitizeDraft } from "@/lib/ai/content";
import type { ScrapedSource } from "@/lib/types";

async function main() {
  const sources: ScrapedSource[] = [
    {
      type: "news",
      title: "제주도 여행객 급증, 올해만 300만명 넘어서",
      summary: "제주도를 찾는 여행객이 급증하고 있다. 올해 누적 방문객이 300만명을 넘어섰다고 관광공사가 밝혔다. 렌터카 수요도 함께 늘었다.",
      url: "https://example.com/1",
    },
    {
      type: "blog",
      title: "제주도 가을 여행 추천 코스",
      summary: "가을에 가기 좋은 제주도 코스를 소개한다. 협재 해수욕장과 오설록 티뮤지엄을 추천한다.",
      url: "https://example.com/2",
    },
  ];

  console.log("1) generateIdeas...");
  const ideasRes = await generateIdeas("제주도 여행", sources, 5);
  if (!ideasRes.ok) {
    console.error("FAIL ideas:", ideasRes.error);
    process.exit(1);
  }
  console.log(`ideas: ${ideasRes.ideas.length}개`);
  console.log(ideasRes.ideas.map((i) => i.title));

  console.log("2) generateDraft (photoSource=none)...");
  const draftRes = await generateDraft("제주도 여행", ideasRes.ideas[0]!, sources, {
    photoSource: "none",
    photoCount: 0,
  });
  if (!draftRes.ok) {
    console.error("FAIL draft:", draftRes.error);
    process.exit(1);
  }
  const draft = sanitizeDraft("live-test", draftRes.draft);
  console.log("title:", draft.title);
  console.log("sections:", draft.sections.length);
  for (const s of draft.sections) {
    console.log(" -", s.type, s.type === "image" ? "❌ none 모드인데 이미지 섹션!" : "");
  }
  const hasMarkdown = draft.sections.some(
    (s) => "text" in s && /(\*\*|~~|`|^#|^>|^- )/.test(s.text),
  );
  console.log("마크다운 유출:", hasMarkdown ? "❌ 있음" : "✅ 없음");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
