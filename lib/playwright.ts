import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { paths } from "@/lib/paths";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// ⚠️ 2-3: "Executable doesn't exist" 로 실패하면 npx playwright install chromium 을
// 자동 실행하고 1회 재시도한다. 설치 Promise는 모듈 레벨에 캐싱해 중복 설치를 막는다.
let installPromise: Promise<void> | null = null;

function isMissingExecutableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Executable doesn'?t exist|please run|install/i.test(msg);
}

function installChromium(): Promise<void> {
  if (!installPromise) {
    installPromise = new Promise((resolve, reject) => {
      const isWin = process.platform === "win32";
      const child = spawn("npx", ["playwright", "install", "chromium"], {
        shell: isWin,
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright install 실패 (code ${code})`));
      });
    });
  }
  return installPromise;
}

async function launchWithAutoInstall(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless });
  } catch (err) {
    if (!isMissingExecutableError(err)) throw err;
    await installChromium();
    return chromium.launch({ headless });
  }
}

export interface NewContextOptions {
  headless: boolean;
  useNaverSession: boolean;
}

export async function newContext(
  opts: NewContextOptions,
): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await launchWithAutoInstall(opts.headless);
  const hasSession = opts.useNaverSession && fs.existsSync(paths.naverSession);

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent: DESKTOP_UA,
    storageState: hasSession ? paths.naverSession : undefined,
  });

  return { browser, context };
}
