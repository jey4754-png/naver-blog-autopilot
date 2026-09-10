import { getDb } from "@/lib/db";
import { getSettings, setSetting, resetSettings } from "@/lib/settings";
import { jobLog, setJobStage } from "@/lib/log";

const db = getDb();
console.log("tables:", db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());

resetSettings();
console.log("defaults:", getSettings());
setSetting("dailyPublishLimit", 999); // 클램프 확인 (max 50)
console.log("clamped:", getSettings().dailyPublishLimit);

db.prepare(`INSERT INTO jobs (id, keyword, status, mode, inputs) VALUES ('t1','테스트','pending','auto','{}')`).run();
setJobStage("t1", { status: "scraping", stage: "collecting" });
jobLog("t1", "info", "테스트 로그");
console.log("job:", db.prepare("SELECT * FROM jobs WHERE id='t1'").get());
console.log("logs:", db.prepare("SELECT * FROM job_logs WHERE job_id='t1'").all());

db.prepare("DELETE FROM jobs WHERE id='t1'").run();
db.prepare("DELETE FROM job_logs WHERE job_id='t1'").run();
console.log("OK");
