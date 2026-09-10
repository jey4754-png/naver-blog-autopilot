import fs from "node:fs";
import path from "node:path";
import { listLocalPhotos, matchPhotosToCaptions } from "@/lib/localPhotos";
import { absDataPath } from "@/lib/paths";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const dir = absDataPath("_test-photos");
  fs.mkdirSync(dir, { recursive: true });
  const names = ["사진10.jpg", "사진2.jpg", "사진1.png", "메모.txt", "썸네일.svg", "사진3.webp"];
  for (const n of names) fs.writeFileSync(path.join(dir, n), "x");

  const listed = listLocalPhotos(dir).map((p) => path.basename(p));
  console.log(listed);
  assert(!listed.includes("메모.txt"), "사진이 아닌 파일은 제외된다");
  assert(!listed.includes("썸네일.svg"), "지원하지 않는 확장자(svg)는 제외된다");
  assert(
    JSON.stringify(listed) === JSON.stringify(["사진1.png", "사진2.jpg", "사진3.webp", "사진10.jpg"]),
    `자연순 정렬(사진1,2,3,10 순)이어야 한다 (실제: ${listed.join(",")})`,
  );

  // ── 매칭 폴백: order 모드는 항상 순차 ──
  const descs = [
    { path: "/a.jpg", desc: "카페 외관" },
    { path: "/b.jpg", desc: "아메리카노 클로즈업" },
    { path: "/c.jpg", desc: "창가 자리 전경" },
  ];
  const seq = await matchPhotosToCaptions(descs, ["1", "2", "3"], "order");
  assert(JSON.stringify(seq) === JSON.stringify(["/a.jpg", "/b.jpg", "/c.jpg"]), "order 모드는 순서대로 배치한다");

  // ── ai 모드 실제 claude 매칭 ──
  const captions = ["커피 마시는 손 클로즈업 사진", "매장 바깥 외경 사진", "창밖이 보이는 좌석 사진"];
  const matched = await matchPhotosToCaptions(descs, captions, "ai");
  console.log("ai 매칭 결과:", matched);
  assert(matched.length === 3, "매칭 결과 개수가 캡션 개수와 같다");
  assert(new Set(matched).size === 3, "같은 사진이 중복 배정되지 않는다");

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
