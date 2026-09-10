import { getDb } from "@/lib/db";
import { DEFAULTS, LIMITS, VISIBILITY_VALUES, type Visibility } from "@/config";

export interface Settings {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: Visibility;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
}

type SettingKey = keyof Settings;

const BOOL_KEYS: SettingKey[] = ["dryRun", "killSwitch", "showBrowser"];
const NUMBER_KEYS: SettingKey[] = [
  "dailyPublishLimit",
  "minPublishIntervalMin",
  "scrapeTopN",
  "imageCandidates",
  "cfImageSteps",
  "claudeTimeoutSec",
  "claudeConcurrency",
];

function clamp(key: SettingKey, n: number): number {
  const limit = (LIMITS as Record<string, { min: number; max: number } | undefined>)[key];
  if (!limit) return n;
  return Math.min(limit.max, Math.max(limit.min, n));
}

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const result = { ...DEFAULTS } as Settings;
  for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
    const raw = stored.get(key);
    if (raw === undefined) continue;
    if (BOOL_KEYS.includes(key)) {
      (result as any)[key] = raw === "true";
    } else if (NUMBER_KEYS.includes(key)) {
      (result as any)[key] = clamp(key, Number(raw));
    } else if (key === "visibility") {
      result.visibility = (VISIBILITY_VALUES as readonly string[]).includes(raw)
        ? (raw as Visibility)
        : DEFAULTS.visibility;
    }
  }
  return result;
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  const db = getDb();
  let stringValue: string;
  if (BOOL_KEYS.includes(key)) {
    stringValue = String(Boolean(value));
  } else if (NUMBER_KEYS.includes(key)) {
    stringValue = String(clamp(key, Number(value)));
  } else if (key === "visibility") {
    stringValue = (VISIBILITY_VALUES as readonly string[]).includes(value as string)
      ? (value as string)
      : DEFAULTS.visibility;
  } else {
    stringValue = String(value);
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, stringValue);
}

export function setSettings(patch: Partial<Settings>): void {
  for (const [key, value] of Object.entries(patch)) {
    setSetting(key as SettingKey, value as never);
  }
}

export function isKnownSettingKey(key: string): key is SettingKey {
  return key in DEFAULTS;
}

export function resetSettings(): void {
  const db = getDb();
  db.prepare(`DELETE FROM settings`).run();
}

export { LIMITS };
