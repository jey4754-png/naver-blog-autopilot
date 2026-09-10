import { draftSchemaFor } from "@/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const base = { title: "t" };
const img = { type: "image" as const, query: "q" };
const p = { type: "paragraph" as const, text: "본문" };

// crawl/ai: 6개 이상 요구
const crawlSchema = draftSchemaFor("crawl");
assert(
  !crawlSchema.safeParse({ ...base, sections: [p, img, img] }).success,
  "crawl 모드: 이미지 3개는 6개 미만이라 거부된다",
);
assert(
  crawlSchema.safeParse({ ...base, sections: [p, img, img, img, img, img, img] }).success,
  "crawl 모드: 이미지 6개는 통과한다",
);

// local: 정확히 N개
const localSchema = draftSchemaFor("local", 4);
assert(
  !localSchema.safeParse({ ...base, sections: [p, img, img, img] }).success,
  "local(4장) 모드: 이미지 3개는 거부된다",
);
assert(
  localSchema.safeParse({ ...base, sections: [p, img, img, img, img] }).success,
  "local(4장) 모드: 이미지 정확히 4개는 통과한다 (6개 미만이어도 OK)",
);

// none: 0개
const noneSchema = draftSchemaFor("none");
assert(
  !noneSchema.safeParse({ ...base, sections: [p, img] }).success,
  "none 모드: 이미지 섹션이 있으면 거부된다",
);
assert(noneSchema.safeParse({ ...base, sections: [p, p] }).success, "none 모드: 이미지 없으면 통과한다");

process.exit(process.exitCode ?? 0);
