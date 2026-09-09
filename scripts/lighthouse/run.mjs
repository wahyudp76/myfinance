/**
 * Tier-2 struktural #7: Lighthouse CI runner (pagar performa).
 *
 * Menjalankan Lighthouse (emulasi mobile) terhadap build statis lokal
 * (python3 http.server) memakai Chromium milik Playwright, lalu
 * membandingkan skor dgn ambang di THRESHOLDS. Gagal satu ambang =
 * exit 1 (CI merah) -- regresi kecepatan/a11y ketahuan sebelum merge.
 *
 * Jalankan lokal: node scripts/lighthouse/run.mjs
 * (butuh: npm ci + npx playwright install --with-deps chromium)
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { resolveChromePath } from "./chrome-path.mjs";

const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const OUT = "/tmp/myfinance-lighthouse.json";

// Ambang dikalibrasi dari run nyata (login screen, emulasi mobile,
// server statis lokal) + margin anti-flake.
// Kalibrasi nyata 2026-08-31 (login, mobile throttle): perf 60 / a11y 92 / bp 100.
// Ambang diberi margin anti-flake. SEO TIDAK diukur -- app pribadi, noindex by design.
export const THRESHOLDS = { performance: 55, accessibility: 85, "best-practices": 90 };

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForServer(deadlineMs = 8_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      await response.arrayBuffer();
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Server statis tidak siap dalam ${deadlineMs} ms${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  let executable;
  try {
    executable = resolveChromePath();
  } catch (error) {
    console.error(`Lighthouse tidak dapat dimulai: ${error.message}`);
    return 2;
  }

  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: resolve(import.meta.dirname, "../.."),
    stdio: "ignore",
    detached: true,
  });

  try {
    // Jangan mengandalkan sleep tetap: cold start mesin/CI yang lebih lambat
    // sebelumnya bisa membuat Lighthouse balapan dengan server statis.
    await waitForServer();

    try {
      unlinkSync(OUT);
    } catch { /* file hasil run sebelumnya memang belum tentu ada */ }

    const args = [
      resolve(import.meta.dirname, "../../node_modules/lighthouse/cli/index.js"),
      URL,
      `--output=json`,
      `--output-path=${OUT}`,
      "--only-categories=performance,accessibility,best-practices",
      `--chrome-flags=--headless --no-sandbox --disable-gpu`,
    ];
    console.log("Menjalankan Lighthouse (emulasi mobile)...");
    // Lighthouse modern (chrome-launcher) hanya membaca env CHROME_PATH.
    const lh = spawnSync(process.execPath, args, {
      stdio: "inherit",
      timeout: 240_000,
      env: { ...process.env, CHROME_PATH: executable },
    });

    if (lh.error || lh.status !== 0) {
      const reason = lh.error?.message || (lh.signal ? `signal ${lh.signal}` : `exit ${lh.status}`);
      console.error(`Lighthouse gagal dijalankan (${reason})`);
      return 2;
    }

    const report = JSON.parse(readFileSync(OUT, "utf8"));
    const scores = {};
    for (const cat of Object.keys(THRESHOLDS)) {
      const s = Math.round((report.categories[cat]?.score ?? 0) * 100);
      scores[cat] = s;
    }
    console.log("\n===== SKOR LIGHTHOUSE =====");
    let failed = false;
    for (const [cat, min] of Object.entries(THRESHOLDS)) {
      const s = scores[cat];
      const ok = s >= min;
      if (!ok) failed = true;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${cat}: ${s} (ambang >= ${min})`);
    }
    // metrik kunci utk observability (tidak menggagalkan build)
    const audits = report.audits || {};
    for (const key of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]) {
      const a = audits[key];
      if (a) console.log(`  .  ${a.title}: ${a.displayValue || "-"}`);
    }
    return failed ? 1 : 0;
  } catch (error) {
    console.error(`Lighthouse gagal dijalankan: ${error.message}`);
    return 2;
  } finally {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* server bisa saja sudah mati duluan */ }
    server.unref();
  }
}

process.exitCode = await main();
