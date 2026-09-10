import path from "node:path";
import { chromium } from "playwright";
import { judgeCrawledImage } from "@/lib/ai/vision";
import { absDataPath } from "@/lib/paths";

async function screenshot(html: string, file: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  await page.setContent(html);
  await page.screenshot({ path: file });
  await browser.close();
}

async function main() {
  const dir = absDataPath("_test-images");
  const watermarkedFile = path.join(dir, "watermarked.png");
  const cleanFile = path.join(dir, "clean.png");

  await screenshot(
    `<body style="margin:0;width:600px;height:400px;background:linear-gradient(135deg,#7ec8e3,#2a5d8a);position:relative;">
       <div style="position:absolute;bottom:12px;right:16px;color:white;font-size:22px;font-family:sans-serif;opacity:0.9;">© dreamstock.com</div>
       <div style="position:absolute;top:40%;left:40%;color:white;font-size:16px;">SAMPLE WATERMARK</div>
     </body>`,
    watermarkedFile,
  );
  await screenshot(
    `<body style="margin:0;width:600px;height:400px;background:linear-gradient(135deg,#a8e063,#56ab2f);"></body>`,
    cleanFile,
  );

  console.log("1) 워터마크 있는 사진 판정...");
  const v1 = await judgeCrawledImage(watermarkedFile, { topic: "제주도 여행", sectionQuery: "제주 바다 풍경" });
  console.log(v1);
  if (v1.fit !== false) {
    console.error("FAIL: 워터마크가 있으면 fit이 false로 강제되어야 한다");
    process.exit(1);
  }
  console.log("ok: 워터마크 → fit 강제 false");

  console.log("2) 깨끗한 사진 판정...");
  const v2 = await judgeCrawledImage(cleanFile, { topic: "제주도 여행", sectionQuery: "초록 들판 풍경" });
  console.log(v2);
  console.log("(참고용 — fit 여부는 AI 주관 판단이라 강제 검증하지 않음)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
