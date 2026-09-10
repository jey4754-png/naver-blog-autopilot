import { filterImageCandidates, categorizeRejection } from "@/lib/scrape/images";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const raw = [
  { src: "https://x.com/a.svg", naturalWidth: 500 },
  { src: "https://x.com/logo-small.png", naturalWidth: 500 },
  { src: "https://x.com/icon.png", naturalWidth: 500 },
  { src: "https://x.com/tiny.jpg", naturalWidth: 80 },
  { src: "https://x.com/good1.jpg", naturalWidth: 400 },
  { src: "https://x.com/good1.jpg", naturalWidth: 400 }, // 중복
  { src: "https://x.com/good2.jpg", naturalWidth: 600 },
  { src: "https://x.com/good3.jpg", naturalWidth: 600 },
];

const filtered = filterImageCandidates(raw, 2);
assert(filtered.length === 2, `limit=2 를 지켜 2개만 반환한다 (실제 ${filtered.length})`);
assert(filtered[0] === "https://x.com/good1.jpg", "svg/logo/icon/작은 이미지가 걸러진 뒤 첫 후보가 온다");

const allFiltered = filterImageCandidates(raw, 10);
assert(allFiltered.length === 3, `중복 제거 후 3개(good1,2,3)만 남는다 (실제 ${allFiltered.length})`);

assert(
  categorizeRejection({ fit: false, watermark: true, koreanPerson: true, reason: "" }) === "워터마크",
  "워터마크가 최우선 사유",
);
assert(
  categorizeRejection({ fit: false, watermark: false, koreanPerson: true, reason: "" }) === "국내 인물(초상권)",
  "그다음 초상권",
);
assert(
  categorizeRejection({ fit: false, watermark: false, koreanPerson: false, reason: "" }) === "주제 불일치",
  "둘 다 아니면 주제 불일치",
);

process.exit(process.exitCode ?? 0);
