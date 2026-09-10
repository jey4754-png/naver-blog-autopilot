import { neuronsPerImage, imagesPerDay } from "@/lib/ai/neurons";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

// 7-12 표: 스텝별 장당/하루 (1024x1024 = 4타일 기준)
const table: [number, number, number][] = [
  [2, 96, 104],
  [4, 173, 57],
  [6, 250, 40],
  [8, 326, 30],
];

for (const [steps, expectedPerImage, expectedPerDay] of table) {
  const perImage = neuronsPerImage(steps);
  const perDay = imagesPerDay(steps);
  assert(Math.round(perImage) === expectedPerImage, `steps=${steps}: 장당 ${Math.round(perImage)} (기대 ${expectedPerImage})`);
  assert(perDay === expectedPerDay, `steps=${steps}: 하루 ${perDay}장 (기대 ${expectedPerDay}장)`);
}

// 실측: 6스텝 = 249.6 (정수 아님)
assert(Math.abs(neuronsPerImage(6) - 249.6) < 1e-9, `6스텝 정확값 249.6 (실제 ${neuronsPerImage(6)})`);
assert(!Number.isInteger(neuronsPerImage(6)), "반환값은 정수가 아니다(화면 표시할 때만 반올림)");

// 실측 검증: 7,738 ÷ 31장 = 249.6...
assert(Math.abs(7738 / 31 - neuronsPerImage(6)) < 0.5, "실측 7738/31 과 0.5 이내로 일치");

process.exit(process.exitCode ?? 0);
