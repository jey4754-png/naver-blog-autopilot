// ⚠️ 7-25 재현: page.keyboard.type 으로 VS16 이모지를 치면 실제 브라우저에서
// base 문자가 중복되는지, typeSafely 로 고치면 사라지는지를 살아있는 contenteditable 에서 확인한다.
import { chromium } from "playwright";
import { typeSafely } from "@/lib/naver/textSafety";

function dump(t: string) {
  return [...t].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(" ");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<div id="a" contenteditable="true" style="font-size:24px"></div>
                          <div id="b" contenteditable="true" style="font-size:24px"></div>`);

  const text = "[⚠️] 완료 ✔️";

  // 고치기 전: 명세 그대로 keyboard.type 만 쓰면 어떻게 되는지 재현
  await page.click("#a");
  await page.keyboard.type(text, { delay: 5 });
  const broken = await page.locator("#a").textContent();

  // 고친 뒤: typeSafely
  await page.click("#b");
  await typeSafely(page, text);
  const fixed = await page.locator("#b").textContent();

  console.log("보냄       :", dump(text));
  console.log("keyboard.type만:", dump(broken ?? ""));
  console.log("typeSafely  :", dump(fixed ?? ""));

  if (broken === text) {
    console.log("참고: 이 브라우저/버전에서는 순수 keyboard.type 도 중복이 재현되지 않았다(환경차 가능).");
  } else {
    console.log("재현됨: keyboard.type 단독 사용 시 실제로 글자가 달라진다 →", JSON.stringify(broken));
  }

  if (fixed !== text) {
    console.error("FAIL: typeSafely 를 써도 원문과 달라짐:", JSON.stringify(fixed));
    process.exit(1);
  }
  console.log("ok: typeSafely 결과가 원문과 정확히 일치한다");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
