import { sanitizeMarkdown, splitForTyping } from "@/lib/naver/textSafety";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

// ── 7-8 마크다운 무력화 ──
assert(sanitizeMarkdown("이건 정말~ 좋아요~") === "이건 정말～ 좋아요～", "물결표 → 전각 물결표");
assert(sanitizeMarkdown("**중요한** 내용") === "중요한 내용", "굵게 기호 제거");
assert(sanitizeMarkdown("__밑줄__ 텍스트") === "밑줄 텍스트", "밑줄 기호 제거");
assert(sanitizeMarkdown("`코드` 조각") === "코드 조각", "백틱 제거");
assert(sanitizeMarkdown("# 제목입니다") === "제목입니다", "# 제목 기호 제거");
assert(sanitizeMarkdown("> 인용문입니다") === "인용문입니다", "> 인용 기호 제거");
assert(sanitizeMarkdown("- 목록 항목") === "목록 항목", "- 목록 기호 제거");

// ── 7-25 VS16 이모지 클러스터 분리 ──
const parts1 = splitForTyping("[⚠️]");
console.log(parts1);
assert(parts1.length === 3, `"[⚠️]" 는 3조각으로 나뉜다 (실제 ${parts1.length})`);
assert(parts1[0]!.text === "[" && !parts1[0]!.useInsertText, "앞부분은 일반 타이핑");
assert(parts1[1]!.text === "⚠️" && parts1[1]!.useInsertText, "이모지 클러스터는 insertText 대상");
assert(parts1[2]!.text === "]" && !parts1[2]!.useInsertText, "뒷부분은 일반 타이핑");

const rejoined1 = parts1.map((p) => p.text).join("");
assert(rejoined1 === "[⚠️]", "조각을 다시 합치면 원문과 같다(글자 유실 없음)");

// 여러 이모지 + 일반 텍스트 혼합
const mixed = "오늘 날씨 ☀️ 진짜 좋아요! ✔️ 완료했습니다 1️⃣번부터 시작";
const parts2 = splitForTyping(mixed);
const rejoined2 = parts2.map((p) => p.text).join("");
assert(rejoined2 === mixed, "복합 문장도 재조합하면 원문과 완전히 같다");
assert(parts2.some((p) => p.useInsertText && p.text === "☀️"), "☀️ 클러스터 인식");
assert(parts2.some((p) => p.useInsertText && p.text === "✔️"), "✔️ 클러스터 인식");
assert(parts2.some((p) => p.useInsertText && p.text === "1️⃣"), "1️⃣ (키캡) 클러스터 인식");

// VS16 없는 일반 이모지/한글은 그대로 한 덩어리로 유지되어야 한다(쪼개질 필요 없음)
const plain = "안녕하세요 😀 반갑습니다";
const parts3 = splitForTyping(plain);
assert(parts3.length === 1 && !parts3[0]!.useInsertText, "VS16 없는 문장은 쪼개지 않는다");

process.exit(process.exitCode ?? 0);
