import Database from "better-sqlite3";
import { ensureDataDirs, paths } from "@/lib/paths";

// ⚠️ 7-17: Next.js dev의 HMR이 모듈을 여러 번 평가한다. globalThis 에 캐싱하지 않으면
// SQLite 파일 핸들이 재요청마다 늘어난다.
declare global {
  // eslint-disable-next-line no-var
  var __blogDb: Database.Database | undefined;
}

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT,
      auto INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL,
      inputs TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      url TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      title TEXT NOT NULL,
      angle TEXT,
      rationale TEXT,
      chosen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      idea_id TEXT,
      title TEXT NOT NULL,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      draft_id TEXT,
      query TEXT,
      src_url TEXT,
      local_path TEXT,
      source_site TEXT NOT NULL,
      verdict_ok INTEGER NOT NULL DEFAULT 0,
      verdict_reason TEXT,
      section_index INTEGER,
      gen_prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      draft_id TEXT,
      status TEXT NOT NULL,
      blog_url TEXT,
      screenshot TEXT,
      note TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sources_job ON sources(job_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_job ON ideas(job_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_job ON drafts(job_id);
    CREATE INDEX IF NOT EXISTS idx_images_job ON images(job_id);
    CREATE INDEX IF NOT EXISTS idx_posts_job ON posts(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
  `);
}

// 컬럼 존재를 확인해 없으면 ALTER TABLE 한다. 기존 DB를 날리지 않기 위함이다 (5장).
function ensureColumn(db: Database.Database, table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

function migrate(db: Database.Database) {
  // 앞으로 컬럼을 추가할 일이 생기면 여기에 ensureColumn 호출을 덧붙인다.
  ensureColumn(db, "jobs", "error", "TEXT");
}

function openDb(): Database.Database {
  ensureDataDirs();
  const db = new Database(paths.dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__blogDb) {
    globalThis.__blogDb = openDb();
  }
  return globalThis.__blogDb;
}
