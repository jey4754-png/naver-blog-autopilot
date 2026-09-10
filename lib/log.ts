import { getDb } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";

export function jobLog(jobId: string, level: LogLevel, message: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`,
  ).run(jobId, level, message);
  // 콘솔에도 남겨서 서버 로그에서 바로 볼 수 있게 한다.
  const tag = level === "error" ? "❌" : level === "warn" ? "⚠️" : "·";
  console.log(`[job ${jobId}] ${tag} ${message}`);
}

export function setJobStage(jobId: string, patch: { status?: string; stage?: string; error?: string }) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.stage !== undefined) {
    fields.push("stage = ?");
    values.push(patch.stage);
  }
  if (patch.error !== undefined) {
    fields.push("error = ?");
    values.push(patch.error);
  }
  fields.push("updated_at = datetime('now')");
  values.push(jobId);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}
