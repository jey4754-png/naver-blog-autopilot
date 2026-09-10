import fs from "node:fs";
import { getDb } from "@/lib/db";
import { resetSettings, setSettings } from "@/lib/settings";
import { checkPublishGuards } from "@/lib/naver/publish";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

function main() {
  const db = getDb();
  db.prepare(`DELETE FROM posts WHERE job_id LIKE 'guard-test%'`).run();
  resetSettings();

  // ── kill-switch ──
  setSettings({ killSwitch: true, dryRun: false });
  let g = checkPublishGuards();
  assert(g.blocked && /전체 중단/.test(g.reason ?? ""), "kill-switch 가 켜지면 즉시 blocked");
  setSettings({ killSwitch: false });

  // ── 7-22: UTC 자정 경계 재현 ──
  // ⚠️ 이 샌드박스 자체의 OS 시간대가 UTC라서(date; TZ= 확인됨), 'localtime' 이 KST(+9)로
  // 바뀌는 실제 사용자 환경(한국 컴퓨터)의 자정 경계를 이 컨테이너에서 그대로 재현할 수는
  // 없다. 대신 같은 버그 유형을, 호스트 시간대에 의존하지 않는 형태로 직접 재현한다:
  // "발행 시각을 UTC로 그대로 비교"(틀림) vs "+9시간 이동한 뒤 비교"(KST 기준, 맞음).
  // 오늘의 KST 날짜를 먼저 구한 뒤, "그 KST 날짜의 새벽 2시"를 UTC 시각 문자열로
  // 역산한다 (KST 02:00 = 전날 UTC 17:00).
  const { kstToday: todayKst } = db
    .prepare(`SELECT date('now', '+9 hours') AS kstToday`)
    .get() as { kstToday: string };
  const prevDay = new Date(todayKst + "T00:00:00Z");
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  const publishedAtUtc = `${prevDay.toISOString().slice(0, 10)} 17:00:00`; // = todayKst 02:00 KST

  const raw = db
    .prepare(
      `SELECT date(?) AS utcDateOfPost, date(?, '+9 hours') AS kstDateOfPost,
              date('now') AS utcToday, date('now', '+9 hours') AS kstToday`,
    )
    .get(publishedAtUtc, publishedAtUtc) as {
    utcDateOfPost: string;
    kstDateOfPost: string;
    utcToday: string;
    kstToday: string;
  };
  console.log("7-22 재현 (발행 시각 UTC:", publishedAtUtc, ")", raw);

  // 틀린 방식: date(published_at) [UTC, 시프트 없음] 을 date('now','localtime') [KST] 과 비교.
  const buggyMatches = raw.utcDateOfPost === raw.kstToday;
  assert(!buggyMatches, "UTC 그대로 비교(옛 방식)는 KST 새벽 발행을 '오늘'에서 놓친다(누락 재현)");

  // 맞는 방식: 양쪽 다 +9시간(KST) 이동 후 비교.
  const fixedMatches = raw.kstDateOfPost === raw.kstToday;
  assert(fixedMatches, "양쪽 다 KST로 맞춰 비교하면(맞는 방식) 정확히 '오늘'로 잡힌다");

  // 실제 코드(publish.ts)가 두 date() 호출 모두에 'localtime' 을 쓰는지 정적으로 확인한다.
  const src = fs.readFileSync(new URL("../lib/naver/publish.ts", import.meta.url), "utf8");
  assert(
    /date\(published_at, 'localtime'\)\s*=\s*date\('now', 'localtime'\)/.test(src),
    "checkPublishGuards 의 하루 집계 SQL이 양쪽 다 'localtime' 을 쓴다(7-22 수정 유지 확인)",
  );

  // ── 하루 한도: 이 샌드박스(UTC)에서도 '오늘' 정상 케이스는 카운트된다 ──
  setSettings({ dailyPublishLimit: 2, minPublishIntervalMin: 0 });
  const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);
  for (let i = 0; i < 2; i++) {
    db.prepare(
      `INSERT INTO posts (id, job_id, status, published_at) VALUES (?, 'guard-test', 'published', ?)`,
    ).run(`guard-test-${i}`, nowIso);
  }
  g = checkPublishGuards();
  assert(g.blocked && /한도/.test(g.reason ?? ""), `오늘 발행 2건이 한도(2편) 초과로 막힌다 (실제: ${JSON.stringify(g)})`);

  db.prepare(`DELETE FROM posts WHERE job_id LIKE 'guard-test%'`).run();

  // ── 최소 간격 ──
  setSettings({ dailyPublishLimit: 50, minPublishIntervalMin: 30 });
  const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString().replace("T", " ").slice(0, 19);
  db.prepare(`INSERT INTO posts (id, job_id, status, published_at) VALUES ('guard-test-recent', 'guard-test', 'published', ?)`).run(
    fiveMinAgo,
  );
  g = checkPublishGuards();
  assert(g.blocked && /분을 더/.test(g.reason ?? ""), `5분 전 발행 + 30분 간격이면 blocked (실제: ${JSON.stringify(g)})`);

  db.prepare(`DELETE FROM posts WHERE job_id LIKE 'guard-test%'`).run();

  // ── 모두 정상이면 통과 ──
  setSettings({ killSwitch: false, dailyPublishLimit: 3, minPublishIntervalMin: 30 });
  g = checkPublishGuards();
  assert(!g.blocked, `가드에 걸릴 것이 없으면 통과한다 (실제: ${JSON.stringify(g)})`);

  resetSettings();
  process.exit(process.exitCode ?? 0);
}

main();
