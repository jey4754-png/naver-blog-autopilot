// ⚠️ 7-1, 7-2 최소 재현: 로컬 HTML로 부분일치 셀렉터의 위험성을 실측한다.
// 계정도 네트워크도 필요 없다 (10장 체크리스트: "최소 재현으로 확인").
import { chromium } from "playwright";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ── 7-1: 취소 vs 취소선 ──
  await page.setContent(`
    <div class="se-popup-container">
      <button class="se-popup-button-cancel">취소</button>
    </div>
    <button class="se-strikethrough-toolbar-button">취소선</button>
  `);

  const oldMatches = await page.locator("button:has-text('취소')").count();
  const newMatches = await page.locator("button.se-popup-button-cancel").count();
  const textIsMatches = await page.locator(".se-popup-container button:text-is('취소')").count();

  assert(oldMatches === 2, `옛 셀렉터(has-text)는 '취소'와 '취소선' 둘 다 잡는다 (실제 ${oldMatches}개)`);
  assert(newMatches === 1, `클래스 기반 셀렉터는 정확히 1개만 잡는다 (실제 ${newMatches}개)`);
  assert(textIsMatches === 1, `:text-is 정확일치도 1개만 잡는다 (실제 ${textIsMatches}개)`);

  // ── 7-2: 발행 vs 예약 발행 0건 ──
  await page.setContent(`
    <button data-click-area="tpb.publish">발행</button>
    <button>예약 발행 0건</button>
  `);
  const oldPublishMatches = await page.locator("button:has-text('발행')").count();
  const newPublishMatches = await page.locator("button[data-click-area='tpb.publish']").count();

  assert(oldPublishMatches === 2, `옛 셀렉터(has-text)는 '발행'과 '예약 발행 0건' 둘 다 잡는다 (실제 ${oldPublishMatches}개)`);
  assert(newPublishMatches === 1, `data-click-area 속성 기반 셀렉터는 정확히 1개만 잡는다 (실제 ${newPublishMatches}개)`);

  await browser.close();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
