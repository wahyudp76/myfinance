import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.MYFINANCE_APP_URL || "https://wahyudp76.github.io/myfinance/";
const email = process.env.PARITY_TEST_EMAIL;
const password = process.env.PARITY_TEST_PASSWORD;
const outputPath = process.env.LEGACY_TRANSACTION_ROWS_FILE || "legacy-rows.json";

if (!email || !password) {
  throw new Error("PARITY_TEST_EMAIL and PARITY_TEST_PASSWORD are required for live legacy parity.");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const transactionResponses = [];
const observedApiPaths = new Set();
const transactionGetStatuses = []; // diagnostik: SEMUA status GET /transactions (walau bukan 200)
const pageErrors = [];

page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", async (response) => {
  try {
    const url = new URL(response.url());
    if (!url.pathname.includes("/rest/v1/")) return;

    observedApiPaths.add(url.pathname);
    if (!url.pathname.endsWith("/transactions")) return;
    if (response.request().method() !== "GET") return;
    // Diagnostik (kejadian race deploy 624aeec): rekam SEMUA status GET /transactions,
    // bukan cuma 200 -- kalau gagal lagi, pesan error memberi tahu status apa yg terlihat.
    transactionGetStatuses.push(response.status());
    if (response.status() !== 200) return;

    const body = await response.json();
    if (Array.isArray(body)) transactionResponses.push(body);
  } catch {
    // Ignore non-JSON/aborted responses; the final assertion reports the absence.
  }
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // TUNGGU OVERLAY authGate BENAR-BENAR HILANG SEBELUM MENYENTUH FORM.
  //
  // Kenapa ini perlu padahal di bawah sudah ada waitFor({state:"visible"}):
  // input email/password sudah "visible" menurut Playwright JAUH sebelum layar
  // "Memeriksa sesi login..." (#authGate) selesai. Selama overlay itu masih
  // ada, ia MENANGKAP pointer event, jadi submit.click() di bawah akan berputar
  // ulang terus sampai timeout 30 detik dengan pesan yang menyesatkan:
  //   '<div id="authGate">…</div> intercepts pointer events'
  // -- terlihat seperti tombolnya rusak, padahal cuma balapan waktu.
  //
  // Ini benar-benar terjadi di CI (run f558ceb, 2026-09-01): job parity merah
  // sementara situs live-nya sendiri sehat (diperiksa langsung: authGate hilang
  // dalam ~1,2 detik, tombol bisa diklik, 0 error). Menunggu kondisi yang
  // SEBENARNYA jadi syarat membuat tes ini deterministik alih-alih flaky.
  await page
    .waitForFunction(() => {
      const gate = document.getElementById("authGate");
      return !gate || gate.classList.contains("hidden") || getComputedStyle(gate).display === "none";
    }, null, { timeout: 60000 })
    .catch(() => {
      // Jangan gagal DI SINI: kalau gate memang macet, biarkan klik di bawah
      // yang gagal supaya pesan error Playwright-nya tetap utuh & informatif.
    });

  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });

  await emailInput.fill(email);
  await passwordInput.fill(password);

  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await passwordInput.press("Enter");
  }

  // Allow the SPA to finish auth/bootstrap and any paginated transaction reads.
  await page.waitForTimeout(10000);

  // HARD GATE: exception tak tertangani selama login/bootstrap/data-load =
  // build GAGAL. Pengamatan traffic REST saja tidak cukup: pada regresi
  // c57dc6d (typo 'respsponse') GET /transactions tetap teramati sukses
  // walau handler .then-nya melempar ReferenceError -- app rusak tapi
  // observasi lolos. pageErrors tadinya hanya dilaporkan, kini menggagalkan.
  if (pageErrors.length) {
    throw new Error(
      `Production page errors observed: ${pageErrors.slice(0, 5).join(" | ")}`
    );
  }

  // An observed successful GET returning [] is a valid read. It means the
  // authenticated account currently has no transaction rows. Do not confuse
  // that with the absence of a transaction request altogether.
  if (!transactionResponses.length) {
    const apiPaths = [...observedApiPaths].slice(0, 20).join(", ") || "none";
    const errors = pageErrors.slice(0, 5).join(" | ") || "none";
    throw new Error(
      `Production transaction read was not observed. ` +
      `Observed REST paths: ${apiPaths}. ` +
      `Transaction GET statuses: ${transactionGetStatuses.join(", ") || "none"}. ` +
      `Page errors: ${errors}. ` +
      `The production transport may have changed, login/bootstrap may have failed, ` +
      `or transactions may now be loaded through a non-REST path.`
    );
  }

  const rows = transactionResponses.flat();
  await fs.writeFile(outputPath, JSON.stringify(rows), "utf8");
  console.log(`Legacy observation written: ${rows.length} rows from ${transactionResponses.length} transaction response(s)`);
} finally {
  await browser.close();
}
