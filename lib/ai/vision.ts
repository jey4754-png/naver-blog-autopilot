import { runClaudeJson } from "@/lib/claude";
import { VisionVerdictSchema, type VisionVerdict } from "@/lib/types";

// ⚠️ 6-6: 세 축을 따로 묻는다. watermark/koreanPerson 이 조금이라도 의심스러우면 true
// (안전한 쪽으로). 그리고 코드에서 watermark || koreanPerson 이면 fit 을 강제로
// false 로 덮어쓴다 — AI가 fit=true로 답해도 무시해야 한다.
export async function judgeCrawledImage(
  imagePath: string,
  context: { topic: string; sectionQuery: string },
): Promise<VisionVerdict> {
  const prompt = `이 사진을 네이버 블로그 글에 쓸 수 있는지 판정하라.
글 주제: ${context.topic}
이 사진이 들어갈 자리의 설명/검색어: ${context.sectionQuery}

세 가지를 각각 판정하라:
- watermark: 워터마크, 사이트 로고, 저작권 표기, 서명, 스톡 사진 출처 표시가 조금이라도 보이면 true. 의심스러우면 true.
- koreanPerson: 한국인으로 보이는 얼굴이 식별 가능하면 true (초상권 위험). 얼굴이 안 보이거나(뒷모습·손·실루엣) 명백한 외국인 스톡이면 false. 애매하면 true(안전한 쪽으로).
- fit: 위 둘이 문제없다는 전제 하에, 주제·위치에 어울리는 사진인지.
- reason: 판정 이유를 한국어 한 문장으로.

출력 형식: { "fit": boolean, "watermark": boolean, "koreanPerson": boolean, "reason": string }`;

  const res = await runClaudeJson(prompt, VisionVerdictSchema, {
    images: [imagePath],
    retries: 1,
  });

  if (!res.ok) {
    // ⚠️ 6-6: 판정 호출이 실패했을 때 그 이미지를 채택하면 안 된다. claude 한도 초과가
    // "검증 안 된 이미지 통과"로 이어지지 않도록 fit:false 로 처리한다.
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${res.error}` };
  }

  const v = res.data;
  if (v.watermark || v.koreanPerson) {
    return { ...v, fit: false };
  }
  return v;
}
