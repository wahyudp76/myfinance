import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ROOT = resolve(import.meta.dirname, "../..");

/**
 * Verifikasi path executable sebelum diberikan ke chrome-launcher.
 * chrome-launcher sendiri melaporkan path yang hilang sebagai
 * ChromePathNotSetError yang menyesatkan; pada Playwright, executablePath()
 * masih dapat mengembalikan path walaupun browser belum di-install.
 */
export function validateChromeExecutable(file, source = "Chrome") {
  const path = String(file || "").trim();
  if (!path) {
    throw new Error(`${source} tidak menghasilkan path executable.`);
  }

  try {
    accessSync(path, constants.F_OK | constants.X_OK);
  } catch {
    throw new Error(
      `${source} tidak tersedia atau tidak executable: ${path}. ` +
      "Jalankan: npx playwright install --with-deps chromium"
    );
  }

  return path;
}

/**
 * CHROME_PATH eksplisit tetap dihormati; jika tidak ada, gunakan Chromium
 * yang dikelola Playwright. Tidak ada path cache yang di-hardcode di runner.
 */
export function resolveChromePath({ env = process.env, nodePath = process.execPath, cwd = DEFAULT_ROOT } = {}) {
  if (String(env.CHROME_PATH || "").trim()) {
    return validateChromeExecutable(env.CHROME_PATH, "CHROME_PATH");
  }

  const result = spawnSync(
    nodePath,
    ["-e", "console.log(require('playwright').chromium.executablePath())"],
    { cwd, encoding: "utf8" }
  );

  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || "").trim();
    throw new Error(
      "Chromium Playwright tidak dapat dideteksi" + (detail ? `: ${detail}` : ".") +
      " Jalankan: npx playwright install --with-deps chromium"
    );
  }

  return validateChromeExecutable(result.stdout, "Chromium Playwright");
}
