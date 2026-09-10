import { designImagePrompt, decodeGeneratedImage, callFluxSchnell } from "@/lib/ai/imagegen";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  // 순수 함수: 작은 버퍼는 거부된다
  assert(decodeGeneratedImage(Buffer.from("ab").toString("base64")) === null, "너무 작은 이미지는 null");
  assert(decodeGeneratedImage(Buffer.alloc(5000, 1).toString("base64")) !== null, "충분히 크면 통과");

  // 키가 없을 때 명확한 에러를 준다 (이 세션엔 Cloudflare 키가 없다)
  const noKey = await callFluxSchnell("a cat", 4);
  console.log("키 없음 응답:", noKey);
  assert(!noKey.ok && /열쇠/.test(noKey.error), "키가 없으면 열쇠 안내 에러를 준다");

  console.log("실제 claude 호출로 프롬프트 설계...");
  const res = await designImagePrompt({
    title: "제주도 가을 여행 후기",
    caption: "협재 해수욕장의 에메랄드빛 바다",
    style: "photo",
  });
  if (!res.ok) {
    console.error("FAIL:", res.error);
    process.exit(1);
  }
  console.log("prompt:", res.prompt);
  assert(res.prompt.includes("no text, no letters, no words, no watermark, no logo"), "네거티브 접미사가 포함된다");
  assert(
    res.prompt.includes("photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail"),
    "스타일 토큰이 그대로 포함된다",
  );
  assert(res.prompt.split(/\s+/).length <= 60, "대략 40단어 내외 (여유있게 60 이내로만 체크)");

  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
