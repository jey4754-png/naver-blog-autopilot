import fs from "node:fs";
import { runClaude } from "@/lib/claude";
import { absDataPath } from "@/lib/paths";

async function main() {
  const long = "제주도 가을 여행은 정말 즐거웠습니다. ".repeat(100);
  console.log("길이:", long.length, "자");
  if (long.length < 2000) throw new Error("테스트 프롬프트가 2000자 미만입니다");

  const res = await runClaude(long + "\n\n위 문장을 한 단어로 요약해줘.");
  console.log("결과:", res);
  if (!res.ok) {
    console.error("FAIL: 긴 프롬프트 호출 실패");
    process.exit(1);
  }
  console.log("ok: 2000자 이상 한글 프롬프트가 깨지지 않고 응답을 받았다");

  // 프로젝트 밖 절대경로 이미지 첨부 확인 (2-1)
  const outsidePath = "/tmp/naver-app-vision-test.png";
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAJZJREFUSEvtlkEKgDAMBF9+5c/0ZT6mFy+CIGjqbrYWetGTZDLZJgTaXm3d/QDMSc4CFEnODhTNnBUomjkbUAxzC/wKlIC0gDXAO/AC3xoQBu4A3sBmDXwFHIETcAVSDvACuAExIAOSAxIgOSABkgMSIDkgAZIDEiA5IAGSAxIgOSABkgMSIDkgAZIDEiA5IAGSAxIgOSABkgMuqxsFN3wSlSMAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(outsidePath, tinyPng);
  const res2 = await runClaude("이 그림에 어떤 도형이 있는지 5단어 이내로 답해줘.", { images: [outsidePath] });
  console.log("프로젝트 밖 경로 이미지 결과:", res2);
  if (!res2.ok) {
    console.error("FAIL: 프로젝트 밖 절대경로 이미지 첨부 실패");
    process.exit(1);
  }
  console.log("ok: 프로젝트 밖(/tmp) 절대경로의 이미지를 claude가 읽었다");
  fs.rmSync(outsidePath, { force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
