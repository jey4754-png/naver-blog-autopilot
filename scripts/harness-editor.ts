// 9장 6.5-a: 로그인 전에도 확인할 수 있는 "입력 순서" 검증. 계정도 네트워크도 필요 없다.
// 실제 lib/naver/publish.ts 를 그대로 실행한다 — 셀렉터 값 자체(9장 6.5-b)가 아니라
// 진입 순서·탈출 클릭·마크다운 무력화·VS16·파일선택창·본문못찾음 실패 처리를 검증한다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { publishToNaver } from "@/lib/naver/publish";
import { resetSettings, setSettings } from "@/lib/settings";
import { absDataPath } from "@/lib/paths";
import type { Draft } from "@/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const FIXTURE = "file://" + path.resolve(__dirname, "fixtures/harness-outer.html");

// 1x1 흰 픽셀 PNG.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// ⚠️ 7-27과 같은 원리: Playwright 액션은 기본 30초를 기다린다. 요소가 없을 수 있는
// 조회는 전부 짧은 timeout 을 주지 않으면, 이 읽기 함수 하나가 몇 분씩 걸릴 수 있다.
async function readHarnessState(page: Page) {
  const T = 3000;
  const frame = page.frameLocator("iframe#mainFrame");
  const harness = await frame.locator("body").evaluate(() => (window as any).__harness, undefined, { timeout: T });
  const titleText = await frame
    .locator(".se-section-documentTitle .se-text-paragraph")
    .innerText({ timeout: T })
    .catch(() => "");
  const bodyHtml = await frame
    .locator("#seContent")
    .innerHTML({ timeout: T })
    .catch(() => "(본문 영역 없음)");
  const searchValue = await frame
    .locator("#searchInput")
    .inputValue({ timeout: T })
    .catch(() => "");
  const captionEmpty = await frame
    .locator(".se-caption")
    .first()
    .evaluate((el) => el.classList.contains("se-is-empty"), undefined, { timeout: T })
    .catch(() => true);
  const quoteComponentText = await frame
    .locator(".se-component.se-quotation")
    .first()
    .innerText({ timeout: T })
    .catch(() => "");
  return { harness, titleText, bodyHtml, searchValue, captionEmpty, quoteComponentText };
}

async function main() {
  resetSettings();
  setSettings({ dryRun: true, showBrowser: false });

  const imagePath = absDataPath("_test-images", "harness-tiny.png");
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from(TINY_PNG_B64, "base64"));

  const draft: Draft = {
    title: "제목입니다 **강조** ~물결~ ⚠️",
    sections: [
      { type: "paragraph", text: "이건 정말~ 좋은 팁인데요, 예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다 ✔️", highlight: "빨리 펴지는 게 훨씬 중요합니다" },
      { type: "quote", text: "짧은 인용구 한 줄" },
      { type: "paragraph", text: "인용구 다음 문단입니다. 여기는 인용구 밖에 있어야 합니다." },
      { type: "divider" },
      { type: "image", query: "테스트 이미지", caption: "캡션 테스트입니다" },
      { type: "paragraph", text: "이미지 다음 마지막 문단입니다." },
    ],
  };

  const imagePaths = new Map<number, string>([[4, imagePath]]);

  let captured: Awaited<ReturnType<typeof readHarnessState>> | undefined;

  console.log("=== 시나리오 A: 정상 진입 (입력 순서 검증) ===");
  const result = await publishToNaver({
    jobId: "harness-a",
    draftId: "harness-draft-a",
    draft,
    imagePaths,
    testEntryUrl: FIXTURE,
    testHooks: {
      beforeClose: async (page) => {
        captured = await readHarnessState(page);
      },
    },
  });

  console.log("결과:", result);
  assert(result.status === "dry_run", `연습 모드이므로 dry_run 이어야 한다 (실제 ${result.status})`);
  assert(!!result.screenshot && fs.existsSync(result.screenshot), "스크린샷 파일이 실제로 저장된다");

  if (!captured) {
    console.error("FAIL: 하네스 상태를 읽지 못했습니다");
    process.exit(1);
  }
  const { harness, titleText, bodyHtml, searchValue, captionEmpty, quoteComponentText } = captured;
  console.log("harness 플래그:", harness);
  console.log("제목 텍스트:", JSON.stringify(titleText));

  // 7-1: 취소선 버튼은 절대 눌리면 안 된다.
  assert(harness.strikethroughClicked === false, "취소선 버튼이 0회 눌렸다 (7-1)");
  // 7-3/팝업: '취소'로 복원 팝업이 닫혔다.
  assert(harness.popupCancelled === true, "복원 팝업이 '취소'로 닫혔다");
  // 7-6: 하단 글감 검색바에 타이핑/포커스가 새지 않았다.
  assert(harness.searchBarTouched === false, "글감 검색바에 타이핑이 새지 않았다 (7-6)");
  assert(searchValue === "", "글감 검색창 값이 비어 있다 (7-6)");
  // 7-5: 인용구/구분선/캡션 뒤 탈출 클릭이 실제로 빈 영역에 떨어져 새 컴포넌트를 만들었다.
  assert(harness.safeZoneClicked >= 2, `탈출 클릭이 빈 영역에 정확히 떨어졌다 (실제 ${harness.safeZoneClicked}회)`);

  // 7-8: 마크다운 기호가 제목에 남아있지 않다.
  assert(!titleText.includes("**"), "제목에 ** 가 남아있지 않다 (7-8)");
  assert(!titleText.includes("~물결~") && titleText.includes("～"), "물결표가 전각으로 치환되었다 (7-8)");

  // 7-25: 이모지가 중복되지 않았다.
  const warningCount = (titleText.match(/⚠️/g) ?? []).length;
  const brokenCount = (titleText.match(/⚠⚠️/g) ?? []).length;
  assert(warningCount === 1 && brokenCount === 0, `이모지가 중복되지 않았다 (실제 "${titleText}")`);

  // 7-5: 인용구 컴포넌트 자체에는 인용구 텍스트만 있고, 다음 문단이 안에 딸려들어가지 않았다.
  console.log("인용구 컴포넌트 텍스트:", JSON.stringify(quoteComponentText));
  assert(quoteComponentText.includes("짧은 인용구 한 줄"), "인용구 컴포넌트에 인용구 텍스트가 들어있다");
  assert(
    !quoteComponentText.includes("인용구 다음 문단입니다"),
    "다음 문단이 인용구 컴포넌트 안으로 딸려 들어가지 않았다 (7-5)",
  );

  const componentCount = (bodyHtml.match(/se-component/g) ?? []).length;
  console.log("컴포넌트 조각 수(대략):", componentCount);

  // 7-18: 캡션이 실제로 채워져 se-is-empty 가 빠졌다.
  assert(captionEmpty === false, "캡션이 채워져 se-is-empty 클래스가 빠졌다 (7-18)");

  console.log("\n=== 시나리오 B: 본문을 찾을 수 없는 경우 (7-26) ===");
  let capturedB: Awaited<ReturnType<typeof readHarnessState>> | undefined;
  const resultB = await publishToNaver({
    jobId: "harness-b",
    draftId: "harness-draft-b",
    draft: { title: "본문 없음 테스트 제목", sections: [{ type: "paragraph", text: "이 글자가 어디로 들어가는지 확인" }] },
    testEntryUrl: FIXTURE + "?noBody=1",
    testHooks: {
      beforeClose: async (page) => {
        capturedB = await readHarnessState(page).catch(() => undefined);
      },
    },
  });
  console.log("결과 B:", resultB);
  assert(resultB.status === "failed", `본문을 못 찾으면 failed 로 끝나야 한다 (실제 ${resultB.status})`);
  assert(!!resultB.screenshot, "실패 시에도 스크린샷을 남긴다");
  if (capturedB) {
    assert(
      !capturedB.titleText.includes("이 글자가 어디로 들어가는지"),
      "본문 내용이 제목 칸으로 새지 않았다 (7-26)",
    );
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
