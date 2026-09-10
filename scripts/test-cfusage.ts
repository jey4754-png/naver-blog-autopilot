import { getDb } from "@/lib/db";
import { getUsage, hasCloudflareKeys } from "@/lib/ai/cfUsage";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const db = getDb();
  db.prepare(`DELETE FROM images WHERE job_id = 'usage-test'`).run();
  db.prepare(
    `INSERT INTO images (id, job_id, source_site, verdict_ok) VALUES ('u1','usage-test','ai',1), ('u2','usage-test','ai',1)`,
  ).run();

  assert(!hasCloudflareKeys(), "이 환경에는 Cloudflare 키가 없다 (추정치 경로 테스트)");
  const usage = await getUsage(6);
  console.log(usage);
  assert(usage.isEstimate, "키가 없으면 추정치로 표시된다");
  assert(Math.abs(usage.neurons - 499.2) < 0.01, `2장 × 249.6 = 499.2 (실제 ${usage.neurons})`);

  db.prepare(`DELETE FROM images WHERE job_id = 'usage-test'`).run();
  process.exit(process.exitCode ?? 0);
}

main();
