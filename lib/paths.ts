import fs from "node:fs";
import path from "node:path";

// 모든 데이터는 프로젝트 아래 ./data 에만 저장한다 (2-2 완전 로컬).
export const dataRoot = path.resolve(process.cwd(), "data");

const dirs = {
  root: dataRoot,
  db: path.join(dataRoot, "db"),
  sessions: path.join(dataRoot, "sessions"),
  images: path.join(dataRoot, "images"),
  screenshots: path.join(dataRoot, "screenshots"),
};

export function ensureDataDirs() {
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const paths = {
  ...dirs,
  dbFile: path.join(dirs.db, "app.db"),
  naverSession: path.join(dirs.sessions, "naver.json"),
};

export function absDataPath(...segments: string[]): string {
  ensureDataDirs();
  return path.join(dataRoot, ...segments);
}

// ~ 를 홈 디렉터리로 확장한다 (6-8).
export function expandHome(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(2));
  return p;
}
