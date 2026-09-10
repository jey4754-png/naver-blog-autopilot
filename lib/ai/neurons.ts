// 순수 함수. 서버·클라이언트 공용 — Cloudflare Workers AI (FLUX) 단가 계산.
// ⚠️ 7-12: "타일 × 4.8 + 스텝 × 9.6" 처럼 보이지만 틀렸다. 스텝 요금은 타일마다 붙는다.
//   잘못: 4×4.8 + 6×9.6   =  76.8/장
//   맞음: 4×(4.8 + 6×9.6) = 249.6/장   ← 실측 7,738 ÷ 31장 = 249.6 (오차 0.4)
// ⚠️ 반환값은 정수가 아니다(6스텝 = 249.6). 표시할 때만 Math.round() 한다.
export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  const clampedSteps = Math.min(Math.max(steps, 1), 8);
  return tiles * (4.8 + clampedSteps * 9.6);
}

export const FREE_DAILY_NEURONS = 10_000;

export function imagesPerDay(steps: number, size = 1024): number {
  const perImage = neuronsPerImage(steps, size);
  return Math.floor(FREE_DAILY_NEURONS / perImage);
}
