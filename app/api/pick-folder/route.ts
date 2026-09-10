import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2 * 60 * 1000; // ⚠️ 7-14: 사용자가 대화상자를 방치하면 요청이 영원히 안 끝난다.

function stripTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "");
}

function runPicker(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("시간 초과"));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export async function POST() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const { stdout, stderr } = await runPicker("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "사진이 들어있는 폴더를 선택하세요")',
      ]);
      if (/User canceled/i.test(stderr)) {
        return NextResponse.json({ ok: false, canceled: true });
      }
      const folder = stripTrailingSep(stdout.trim());
      if (!folder) {
        return NextResponse.json({ ok: false, canceled: true });
      }
      return NextResponse.json({ ok: true, folder });
    }

    if (platform === "win32") {
      // ⚠️ 7-14: -STA 가 반드시 필요하다 — WinForms 대화상자는 STA 아파트먼트에서만 뜬다.
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
      const { stdout } = await runPicker("powershell", ["-NoProfile", "-STA", "-Command", script]);
      const folder = stripTrailingSep(stdout.trim());
      if (!folder) {
        return NextResponse.json({ ok: false, canceled: true });
      }
      return NextResponse.json({ ok: true, folder });
    }

    // ⚠️ 7-14: 대화상자를 못 띄우는 플랫폼에서는 "직접 입력해 주세요" 를 반환한다.
    return NextResponse.json({
      ok: false,
      manual: true,
      message: "이 환경에서는 폴더 선택창을 지원하지 않습니다. 경로를 직접 입력해 주세요.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
