// 타이핑 직전에 적용하는 순수 텍스트 변환들. 브라우저가 필요 없어 독립적으로 검증할 수 있다.

// ⚠️ 7-8: 스마트에디터가 마크다운을 자동 서식으로 바꾼다. AI에게 쓰지 말라고 지시하는
// 것만으로는 부족해서, 타이핑 직전에 한 번 더 무력화한다.
export function sanitizeMarkdown(text: string): string {
  return text
    .replace(/~+/g, "～") // 전각 물결표로 (어감은 보존)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

// ⚠️ 7-25: VS16(U+FE0F) 이 붙은 이모지(⚠️ ❤️ ✔️ ☀️ 1️⃣ 등)를 page.keyboard.type 으로
// 치면 base 문자가 중복 입력된다("⚠️" → "⚠⚠️"). 그렇다고 keyboard.insertText 로
// 문단 전체를 넣으면 이모지 하나만 남고 나머지 글이 사라진다(실측). VS16 클러스터만
// 잘라 그 조각만 insertText 하고, 나머지는 명세대로 keyboard.type 한다.
const VS16_CLUSTER = /([\s\S]️⃣?)/;
const HAS_VS16 = /️/;

export interface TextPart {
  text: string;
  useInsertText: boolean;
}

export function splitForTyping(text: string): TextPart[] {
  return text
    .split(VS16_CLUSTER)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, useInsertText: HAS_VS16.test(part) }));
}

// page.keyboard 를 쓰는 실제 타이핑 헬퍼. VS16 클러스터만 insertText, 나머지는 delay를
// 준 keyboard.type. publish.ts 의 모든 텍스트 입력이 이 함수를 거친다.
export async function typeSafely(
  page: { keyboard: { insertText(text: string): Promise<void>; type(text: string, opts?: { delay?: number }): Promise<void> } },
  text: string,
  delay = 7,
): Promise<void> {
  for (const part of splitForTyping(text)) {
    if (part.useInsertText) {
      await page.keyboard.insertText(part.text);
    } else {
      await page.keyboard.type(part.text, { delay });
    }
  }
}
