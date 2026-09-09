// Guard untuk runner Lighthouse: executablePath() Playwright dapat menunjuk
// cache yang belum di-install. Validasi eksplisit mencegah error generik dari
// chrome-launcher dan memastikan runner tidak meninggalkan server yatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateChromeExecutable, resolveChromePath } from "../../scripts/lighthouse/chrome-path.mjs";

test("validasi executable menerima binary yang benar-benar ada dan executable", () => {
  assert.equal(validateChromeExecutable(process.execPath, "uji"), process.execPath);
});

test("validasi executable menolak path cache yang hilang dengan instruksi install", () => {
  assert.throws(
    () => validateChromeExecutable(resolve("/tmp", "chromium-yang-tidak-ada"), "uji"),
    /tidak tersedia atau tidak executable.*playwright install.*chromium/i
  );
});

test("CHROME_PATH eksplisit dipakai dan divalidasi tanpa hardcode path browser", () => {
  assert.equal(
    resolveChromePath({ env: { CHROME_PATH: process.execPath } }),
    process.execPath
  );
});
