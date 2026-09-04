import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { slugify, slugifyCtx } from "../../src/domain/slugify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi DEFAULT __slugify dari app.src.js ----------
// Sejak v79, implementasi monolit asli dipertahankan sebagai DEFAULT di `__slugify`
// (objek top-level), dan fungsi global slugify menjadi delegasi tipis ke __slugify.
function extractSlugifyDefault(name) {
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __slugify.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
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
  monolithFns.slugify = extractSlugifyDefault("slugify");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================
test("slugify: non-alphanumeric diganti underscore (satu per karakter)", () => {
  assert.equal(slugify("Makanan & Minuman"), "Makanan___Minuman"); // spasi, &, spasi = 3
  assert.equal(slugify("Kafe & Kopi"), "Kafe___Kopi");            // spasi, &, spasi = 3
  assert.equal(slugify("Ongkos-Listrik"), "Ongkos_Listrik");      // '-' = 1
  assert.equal(slugify("abc123"), "abc123");
});

test("slugify: spasi & karakter khusus jadi underscore; mempertahankan huruf/angka", () => {
  assert.equal(slugify("Gaji Pokok"), "Gaji_Pokok");
  assert.equal(slugify("Taksi/Ojol"), "Taksi_Ojol");
  assert.equal(slugify("Pencucian #1"), "Pencucian__1"); // spasi, # = 2
  assert.equal(slugify(""), "");
});

test("slugify: non-string di-coerce ke String", () => {
  assert.equal(slugify(null), "null");
  assert.equal(slugify(undefined), "undefined");
  assert.equal(slugify(12345), "12345");
  assert.equal(slugify(3.14), "3_14");
});

test("slugifyCtx: menyediakan fungsi slug", () => {
  const c = slugifyCtx();
  assert.equal(typeof c.slugify, "function");
  assert.equal(c.slugify("Makanan & Minuman"), "Makanan___Minuman");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __slugify (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: slugify modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    "", "abc", "Makanan & Minuman", "Kafe & Kopi", "Taksi/Ojol", "Ongkos-Listrik",
    "Gaji Pokok", "Pencucian #1", "Bensin", null, undefined, 0, 12345, 3.14, true,
  ];
  for (const v of cases) {
    assert.equal(slugify(v), monolithFns.slugify(v), `slugify(${JSON.stringify(v)})`);
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __slugify + delegator global
// ============================================================================
test("WIRING: app.src.js punya __slugify + adoptSlugifyModule + delegasi slugify -> __slugify", () => {
  assert.match(MONOLITH_SRC, /let __slugify\s*=/);
  assert.match(MONOLITH_SRC, /adoptSlugifyModule\s*\(/);
  assert.match(MONOLITH_SRC, /typeof servicesModule\.slugifyCtx\s*===\s*["']function["']/);
  assert.match(MONOLITH_SRC, /__slugify\s*=\s*servicesModule\.slugifyCtx\(\)/);
  const fnSrc = (MONOLITH_SRC.match(/function\s+slugify\s*\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
  assert.match(fnSrc, /__slugify\.slugify/, "slugify harus delegasi ke __slugify.slugify");
});

test("WIRING: index.html mengimpor slugifyCtx & memaparkannya di __myfinanceServices", () => {
  const HTML_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(HTML_SRC, /import\s+\{[^}]*\bslugifyCtx\b[^}]*\}\s+from\s+['"].*\bsrc\/domain\/slugify\.js/);
  assert.match(HTML_SRC, /\bslugifyCtx\b\s*,/);
  assert.equal(typeof slugify, "function");
});
