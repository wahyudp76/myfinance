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

const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const OUT = "/tmp/myfinance-lighthouse.json";

// Ambang dikalibrasi dari run nyata (login screen, emulasi mobile,
// server statis lokal) + margin anti-flake.
// Kalibrasi nyata 2026-08-31 (login, mobile throttle): perf 60 / a11y 92 / bp 100.
// Ambang diberi margin anti-flake. SEO TIDAK diukur -- app pribadi, noindex by design.
export const THRESHOLDS = { performance: 55, accessibility: 85, "best-practices": 90 };

function chromePath() {
  const res = spawnSync(process.execPath, ["-e", "console.log(require('playwright').chromium.executablePath())"], {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  });
  const p = (res.stdout || "").trim();
  if (!p) throw new Error("Chromium Playwright tidak ketemu (jalankan: npx playwright install chromium)");
  return p;
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: resolve(import.meta.dirname, "../.."),
  stdio: "ignore",
  detached: true,
});
// beri waktu server naik
await new Promise((r) => setTimeout(r, 1200));

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
// Lighthouse modern (chrome-launcher) hanya membaca env CHROME_PATH
const lh = spawnSync(process.execPath, args, {
  stdio: "inherit",
  timeout: 240_000,
  env: { ...process.env, CHROME_PATH: chromePath() },
});
try { process.kill(-server.pid, "SIGTERM"); } catch { /* server bisa saja sudah mati duluan */ }
server.unref();

if (lh.status !== 0) {
  console.error("Lighthouse gagal dijalankan (exit " + lh.status + ")");
  process.exit(2);
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
process.exit(failed ? 1 : 0);
