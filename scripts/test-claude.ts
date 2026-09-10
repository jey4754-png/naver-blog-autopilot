import { z } from "zod";
import { checkClaude, runClaude, runClaudeJson } from "@/lib/claude";

async function main() {
  console.log("1) checkClaude:", await checkClaude());

  const longKorean = "안녕하세요. ".repeat(250) + " 이 문장을 그대로 20자 이내로 한 줄 요약해줘.";
  console.log("길이:", longKorean.length);
  const r1 = await runClaude(longKorean);
  console.log("2) 긴 한글 프롬프트:", r1);

  const schema = z.object({ items: z.array(z.string()).length(3) });
  const r2 = await runClaudeJson(
    "과일 이름 3개를 JSON으로 다오. 예: {\"items\":[\"사과\",\"배\",\"감\"]} 앞뒤에 설명이나 코드펜스를 붙여서 줘도 된다.",
    schema,
  );
  console.log("3) JSON (코드펜스 허용 테스트):", r2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
