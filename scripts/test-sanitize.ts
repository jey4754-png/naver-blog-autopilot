import { sanitizeDraft } from "@/lib/ai/content";
import type { Draft } from "@/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

// ⚠️ 7-24 재현: highlight가 본문에 실제로 없는 경우
const draft: Draft = {
  title: "테스트",
  sections: [
    {
      type: "paragraph",
      text: "옆 사이트는 한 시간째 폴대와 씨름 중이더라고요. 그때 확신했습니다.",
      highlight: "예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다", // 본문에 없음
    },
    {
      type: "paragraph",
      text: "저는 가격보다 속도가 중요하다고 늘 생각해왔어요.",
      highlight: "속도가 중요하다", // 본문에 실제로 있음
    },
  ],
};

const cleaned = sanitizeDraft("test-job", draft);
const p0 = cleaned.sections[0];
const p1 = cleaned.sections[1];

assert(p0?.type === "paragraph" && !("highlight" in p0 && p0.highlight), "본문에 없는 highlight는 제거된다");
assert(p1?.type === "paragraph" && p1.highlight === "속도가 중요하다", "본문에 있는 highlight는 유지된다");
assert(cleaned.sections.length === 2, "섹션 개수 자체는 줄지 않는다(초안 전체를 버리지 않는다)");

process.exit(process.exitCode ?? 0);
