import { spawn } from "node:child_process";
import { z } from "zod";
import { getSettings } from "@/lib/settings";

// ⚠️ 2-1: Anthropic API 키(@anthropic-ai/sdk)를 쓰지 않는다. 종량 과금이 되기 때문이다.
// 이 앱은 로컬에 설치된 `claude` CLI를 자식 프로세스로 실행해, 사용자의 구독요금제로 돌아간다.

const isWin = process.platform === "win32";

function resolveBin(): string {
  return process.env.CLAUDE_BIN?.trim() || "claude";
}

// ── 동시성 세마포어 ────────────────────────────────────────
// claude 프로세스를 무제한으로 띄우면 머신이 죽는다. 호출 시점마다 설정값을 다시 읽어
// 설정 변경이 즉시 반영되게 한다.
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  async acquire(limit: number): Promise<() => void> {
    if (this.active >= limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    return () => {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}

const semaphore = new Semaphore();

export interface RunClaudeOptions {
  images?: string[];
  system?: string;
}

export type RunClaudeResult = { ok: true; text: string } | { ok: false; error: string };

function buildPrompt(prompt: string, images?: string[]): string {
  if (!images || images.length === 0) return prompt;
  // ⚠️ 2-1: 비전(이미지 판단)도 같은 방식으로 된다. 프롬프트 끝에 @/절대/경로 를 붙이면
  // claude가 이미지를 읽는다. 프로젝트 밖의 절대경로도 동작한다(검증됨).
  const refs = images.map((p) => `@${p}`).join(" ");
  return `${prompt}\n\n${refs}`;
}

export async function runClaude(prompt: string, opts?: RunClaudeOptions): Promise<RunClaudeResult> {
  const settings = getSettings();
  const release = await semaphore.acquire(settings.claudeConcurrency);
  try {
    return await runOnce(prompt, opts, settings.claudeTimeoutSec);
  } finally {
    release();
  }
}

function runOnce(prompt: string, opts: RunClaudeOptions | undefined, timeoutSec: number): Promise<RunClaudeResult> {
  return new Promise((resolve) => {
    const bin = resolveBin();
    const args = ["-p", "--output-format", "json"];
    if (opts?.system) {
      args.push("--append-system-prompt", opts.system);
    }

    // ⚠️ 11장-1 / 6-1: npm 전역 바이너리는 windows에서 claude.cmd 셸 심으로 깔리고
    // spawn 이 .cmd 를 직접 실행하지 못해 ENOENT 로 죽는다. shell:true 로 우회한다.
    // 프롬프트를 argv가 아니라 stdin으로 넘기므로 argv에는 옵션 플래그만 있고
    // 셸 인용부호 문제가 생길 여지가 없어 안전하다.
    const child = spawn(bin, args, { shell: isWin });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, error: `claude 응답이 ${timeoutSec}초 안에 오지 않았습니다` });
    }, timeoutSec * 1000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `claude 실행 실패: ${err.message}` });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolve({ ok: false, error: stderr.trim() || `claude 종료 코드 ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) {
          resolve({ ok: false, error: String(parsed.result ?? "claude 오류") });
          return;
        }
        resolve({ ok: true, text: String(parsed.result ?? "") });
      } catch {
        // 응답 JSON 파싱 실패 시 raw stdout 을 그대로 텍스트로 반환(폴백).
        resolve({ ok: true, text: stdout });
      }
    });

    // ⚠️ 2-1: 프롬프트를 argv로 넘기면 긴 한글에서 escaping이 깨진다. 반드시 stdin.
    child.stdin.write(buildPrompt(prompt, opts?.images));
    child.stdin.end();
  });
}

const JSON_FORCE_SYSTEM =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

function extractJson(text: string): string | null {
  // ① ```json ... ``` 펜스를 먼저 찾는다.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();

  // ② 없으면 첫 { 또는 [ 부터 마지막 짝 문자까지 잘라낸다.
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const starts = [objStart, arrStart].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1).trim();
}

export interface RunClaudeJsonOptions extends RunClaudeOptions {
  retries?: number;
}

export async function runClaudeJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts?: RunClaudeJsonOptions,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const retries = opts?.retries ?? 2;
  const system = [opts?.system, JSON_FORCE_SYSTEM].filter(Boolean).join("\n\n");

  let lastError = "AI 응답을 받지 못했습니다";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await runClaude(prompt, { images: opts?.images, system });
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const jsonText = extractJson(res.text);
    if (!jsonText) {
      lastError = "AI 응답에서 JSON을 찾지 못했습니다";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      lastError = "AI가 만든 JSON 형식이 깨졌습니다";
      continue;
    }
    const validated = schema.safeParse(parsed);
    if (validated.success) {
      return { ok: true, data: validated.data };
    }
    // Zod 검증 실패도 재시도 사유다.
    lastError = `AI 응답이 기대한 형식과 다릅니다: ${validated.error.issues[0]?.message ?? ""}`;
  }
  return { ok: false, error: lastError };
}

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export function checkClaude(): Promise<ClaudeStatus> {
  return new Promise((resolve) => {
    const bin = resolveBin();
    const child = spawn(bin, ["--version"], { shell: isWin });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ installed: false, error: "확인 시간 초과" });
    }, 10_000);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ installed: false, error: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        resolve({ installed: true, version: stdout.trim() });
      } else {
        resolve({ installed: false, error: stderr.trim() || "claude --version 실패" });
      }
    });
  });
}
