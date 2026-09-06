import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  resolvePlatformLogoUrl,
  normalizePlatformKey,
  compactPlatformKey,
  platformLogoCtx,
  MIN_FUZZY_LEN,
} from "../../src/domain/platform-logos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");
const INDEX_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");

// Katalog contoh meniru bentuk nyata platformLogoByKey setelah load dari tabel
// platform_logos: key = platform_key + display_name.lowercase.
const CATALOG = {
  "bibit": "icons/platforms/bibit.svg",
  "danamas-stabil": "icons/platforms/danamas-stabil.png",
  "danamas stabil": "icons/platforms/danamas-stabil.png",
  "goto": "icons/platforms/goto.svg",
  "stockbit": "icons/platforms/stockbit.svg",
};

// ---------- helper: ekstrak DEFAULT __platformLogos dari app.src.js ----------
// (pola yang sama dengan tests/unit/bank-icons-domain.test.js)
function extractPlatformLogosDefault() {
  const start = MONOLITH_SRC.indexOf("let __platformLogos = ");
  assert.ok(start >= 0, "Blok default __platformLogos tidak ditemukan di app.src.js -- kontrak berubah?");
  const anchor = "})();\nfunction adoptPlatformLogosModule()";
  const end = MONOLITH_SRC.indexOf(anchor, start);
  assert.ok(end > start, "Penutup blok default __platformLogos tidak ditemukan -- kontrak berubah?");
  const expr = MONOLITH_SRC.slice(start + "let __platformLogos = ".length, end + 4).trim();
  const obj = Function(`"use strict"; return ${expr};`)();
  assert.ok(obj && typeof obj.resolvePlatformLogoUrl === "function", "DEFAULT __platformLogos.resolvePlatformLogoUrl bukan fungsi");
  return obj;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================

test("resolvePlatformLogoUrl: kecocokan EXACT nama ternormalisasi", () => {
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Bibit"), "icons/platforms/bibit.svg");
  assert.equal(resolvePlatformLogoUrl(CATALOG, "  BIBIT "), "icons/platforms/bibit.svg");
  assert.equal(resolvePlatformLogoUrl(CATALOG, "GoTo"), "icons/platforms/goto.svg");
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Stockbit"), "icons/platforms/stockbit.svg");
});

test("resolvePlatformLogoUrl: kecocokan EXACT bentuk compact (variasi tanda baca/spasi)", () => {
  // display_name "Danamas Stabil" vs key "danamas-stabil" -> compact keduanya "danamasstabil".
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Danamas Stabil"), "icons/platforms/danamas-stabil.png");
  assert.equal(resolvePlatformLogoUrl(CATALOG, "danamas  stabil"), "icons/platforms/danamas-stabil.png");
});

test("resolvePlatformLogoUrl: containment DIIZINKAN bila token pendek >= 5 huruf", () => {
  // "bibit.id" (compact "bibitid") memuat "bibit" (5) -> cocok.
  assert.equal(resolvePlatformLogoUrl(CATALOG, "bibit.id"), "icons/platforms/bibit.svg");
  // "Reksadana Bibit" memuat "bibit".
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Reksadana Bibit"), "icons/platforms/bibit.svg");
});

test("resolvePlatformLogoUrl: ANTI false-positive -- token pendek < 5 TIDAK boleh containment", () => {
  // AKAR REGRESI v86: "Dana" (e-wallet, 4 huruf) dulu salah cocok ke
  // "danamasstabil" karena containment tanpa batas panjang.
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Dana"), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, "DANA"), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, "go"), null); // "goto" tidak boleh kebagian "go"
});

test("resolvePlatformLogoUrl: input kosong/tidak ada katalog -> null", () => {
  assert.equal(resolvePlatformLogoUrl(null, "Bibit"), null);
  assert.equal(resolvePlatformLogoUrl(undefined, "Bibit"), null);
  assert.equal(resolvePlatformLogoUrl({}, "Bibit"), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, ""), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, null), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, "   "), null);
});

test("resolvePlatformLogoUrl: nama tak dikenal -> null (lanjut fallback lokal)", () => {
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Platform Magic"), null);
  assert.equal(resolvePlatformLogoUrl(CATALOG, "Emas Antam"), null);
});

test("resolvePlatformLogoUrl: entri katalog bernilai kosong di-skip, bukan mengembalikan ''", () => {
  const catalog = { "bibit": "", "stockbit": "icons/platforms/stockbit.svg" };
  assert.equal(resolvePlatformLogoUrl(catalog, "bibit"), null);
  assert.equal(resolvePlatformLogoUrl(catalog, "Bibit"), null); // exact match tapi nilai kosong -> lanjut cari
  assert.equal(resolvePlatformLogoUrl(catalog, "Stockbit"), "icons/platforms/stockbit.svg");
});

test("helper: normalizePlatformKey / compactPlatformKey", () => {
  assert.equal(normalizePlatformKey("  GoTo "), "goto");
  assert.equal(normalizePlatformKey(null), "");
  assert.equal(compactPlatformKey("Danamas-Stabil"), "danamasstabil");
  assert.equal(compactPlatformKey("BIBIT.ID"), "bibitid");
  assert.equal(MIN_FUZZY_LEN, 5);
});

// ============================================================================
// GUARD KONSISTENSI: modul vs DEFAULT __platformLogos (kebenaran produksi)
// ============================================================================

test("KONSISTENSI: resolvePlatformLogoUrl modul == DEFAULT __platformLogos monolit", () => {
  const def = extractPlatformLogosDefault();
  const cases = [
    [CATALOG, "Bibit"], [CATALOG, "  BIBIT "], [CATALOG, "Danamas Stabil"],
    [CATALOG, "Dana"], [CATALOG, "DANA"], [CATALOG, "bibit.id"], [CATALOG, ""],
    [CATALOG, null], [null, "Bibit"], [{}, "Bibit"], [CATALOG, "Platform Magic"],
    [{ bibit: "" }, "Bibit"],
  ];
  for (const [catalog, name] of cases) {
    assert.deepEqual(
      resolvePlatformLogoUrl(catalog, name),
      def.resolvePlatformLogoUrl(catalog, name),
      `resolvePlatformLogoUrl(${JSON.stringify(name)})`,
    );
  }
});

// ============================================================================
// WIRING: monolit benar2 memakai resolver + adoption + servicesModule
// ============================================================================

test("WIRING: app.src.js punya __platformLogos + adopt + getAccountLogo mendelegasikan", () => {
  assert.match(MONOLITH_SRC, /let __platformLogos\s*=/);
  assert.match(MONOLITH_SRC, /function adoptPlatformLogosModule\s*\(/);
  assert.match(MONOLITH_SRC, /__platformLogos\s*=\s*servicesModule\.platformLogoCtx\(\)/);
  assert.match(MONOLITH_SRC, /adoptPlatformLogosModule\(\)/);
  // getAccountLogo harus memanggil resolver, BUKAN logika fuzzy inline lama.
  assert.match(MONOLITH_SRC, /__platformLogos\.resolvePlatformLogoUrl\(platformLogoByKey,\s*candidate\)/);
  assert.doesNotMatch(MONOLITH_SRC, /compactKey\.includes\(compactName\)/, "logika fuzzy lama masih ada -- harus sudah dipindah ke modul");
});

test("WIRING: index.html meng-import platformLogoCtx & memasukkannya ke servicesModule", () => {
  assert.match(INDEX_SRC, /import \{ platformLogoCtx \} from ['"]\.\/src\/domain\/platform-logos\.js['"]/);
  assert.match(INDEX_SRC, /platformLogoCtx\s*,/);
});

test("platformLogoCtx: menyediakan resolver utk DI", () => {
  const ctx = platformLogoCtx();
  assert.equal(typeof ctx.resolvePlatformLogoUrl, "function");
  assert.equal(ctx.resolvePlatformLogoUrl, resolvePlatformLogoUrl);
});
