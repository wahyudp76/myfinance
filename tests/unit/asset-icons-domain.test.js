import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { detectAssetCategoryIcon, assetIconCtx } from "../../src/domain/asset-icons.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi DEFAULT __assetIcon dari app.src.js ----------
// Sejak v79, implementasi monolit asli dipertahankan sebagai DEFAULT di `__assetIcon`
// (objek top-level), dan fungsi global detectAssetCategoryIcon menjadi delegasi tipis.
function extractAssetIconDefault(name) {
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __assetIcon.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  const fnOnly = fnSource.replace(new RegExp("\\s*^\\s*" + name + "\\s*:\\s*", "m"), "");
  return Function(`"use strict"; return (${fnOnly});`)();
}

const monolithFns = {};
try {
  monolithFns.detectAssetCategoryIcon = extractAssetIconDefault("detectAssetCategoryIcon");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================
test("detectAssetCategoryIcon: semua kategori dikenal petakan ke ikon yang tepat", () => {
  assert.equal(detectAssetCategoryIcon("Saham"), "fa-chart-line");
  assert.equal(detectAssetCategoryIcon("Reksadana"), "fa-layer-group");
  assert.equal(detectAssetCategoryIcon("Emas"), "fa-coins");
  assert.equal(detectAssetCategoryIcon("Logam Mulia"), "fa-coins");
  assert.equal(detectAssetCategoryIcon("Kripto"), "fa-bitcoin-sign");
  assert.equal(detectAssetCategoryIcon("Bitcoin"), "fa-bitcoin-sign");
  assert.equal(detectAssetCategoryIcon("Properti"), "fa-house");
  assert.equal(detectAssetCategoryIcon("Tanah"), "fa-house");
  assert.equal(detectAssetCategoryIcon("Rumah"), "fa-house");
  assert.equal(detectAssetCategoryIcon("Deposito"), "fa-piggy-bank");
  assert.equal(detectAssetCategoryIcon("Tabungan"), "fa-piggy-bank");
  assert.equal(detectAssetCategoryIcon("Obligasi"), "fa-file-contract");
  assert.equal(detectAssetCategoryIcon("Bond"), "fa-file-contract");
});

test("detectAssetCategoryIcon: kategori tak dikenal -> fa-gem; case-insensitive", () => {
  assert.equal(detectAssetCategoryIcon("Pembayaran"), "fa-gem");
  assert.equal(detectAssetCategoryIcon("SAHAM"), "fa-chart-line");
  assert.equal(detectAssetCategoryIcon("reksa dana"), "fa-layer-group");
  assert.equal(detectAssetCategoryIcon(""), "fa-gem");
});

test("detectAssetCategoryIcon: non-string di-coerce (null/undefined aman)", () => {
  assert.equal(detectAssetCategoryIcon(null), "fa-gem");
  assert.equal(detectAssetCategoryIcon(undefined), "fa-gem");
  assert.equal(detectAssetCategoryIcon(0), "fa-gem");
});

test("assetIconCtx: menyediakan fungsi pemetaan", () => {
  const c = assetIconCtx();
  assert.equal(typeof c.detectAssetCategoryIcon, "function");
  assert.equal(c.detectAssetCategoryIcon("Saham"), "fa-chart-line");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __assetIcon (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: detectAssetCategoryIcon modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    "Saham", "saham", "Reksadana", "reksa dana", "Emas", "Logam Mulia", "Kripto", "Bitcoin",
    "Properti", "Tanah", "Rumah", "Deposito", "Tabungan", "Obligasi", "Bond",
    "Pembayaran", "", null, undefined, 0, 123,
  ];
  for (const v of cases) {
    assert.equal(
      detectAssetCategoryIcon(v),
      monolithFns.detectAssetCategoryIcon(v),
      `detectAssetCategoryIcon(${JSON.stringify(v)})`,
    );
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __assetIcon + delegator global
// ============================================================================
test("WIRING: app.src.js punya __assetIcon + adoptAssetIconModule + delegasi detectAssetCategoryIcon", () => {
  assert.match(MONOLITH_SRC, /let __assetIcon\s*=/);
  assert.match(MONOLITH_SRC, /adoptAssetIconModule\s*\(/);
  assert.match(MONOLITH_SRC, /typeof servicesModule\.assetIconCtx\s*===\s*["']function["']/);
  assert.match(MONOLITH_SRC, /__assetIcon\s*=\s*servicesModule\.assetIconCtx\(\)/);
  const fnSrc = (MONOLITH_SRC.match(/function\s+detectAssetCategoryIcon\s*\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
  assert.match(fnSrc, /__assetIcon\.detectAssetCategoryIcon/, "detectAssetCategoryIcon harus delegasi ke __assetIcon");
});

test("WIRING: index.html mengimpor assetIconCtx & memaparkannya di __myfinanceServices", () => {
  const HTML_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(HTML_SRC, /import\s+\{[^}]*\bassetIconCtx\b[^}]*\}\s+from\s+['"].*\bsrc\/domain\/asset-icons\.js/);
  assert.match(HTML_SRC, /\bassetIconCtx\b\s*,/);
  assert.equal(typeof detectAssetCategoryIcon, "function");
});
