import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveAccountCurrency, accountCurrencyCtx } from "../../src/domain/account-currency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi DEFAULT __accountCurrency dari app.src.js ----------
// Sejak v82, implementasi monolit asli dipertahankan sebagai DEFAULT di `__accountCurrency`,
// dan fungsi global getAccountCurrency menjadi delegasi tipis (meneruskan
// appSettings.account_currencies sbg parameter DI). Kita ekstrak implementasi default-nya.
function extractAccountCurrencyDefault(name) {
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __accountCurrency.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
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
  monolithFns.resolveAccountCurrency = extractAccountCurrencyDefault("resolveAccountCurrency");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================
test("resolveAccountCurrency: akun yang terdaftar -> mata uangnya; case-akun tetap apapun", () => {
  const map = { "Tabungan USD": "USD", "Bank Konvensional": "IDR", "Emas": "IDR" };
  assert.equal(resolveAccountCurrency(map, "Tabungan USD"), "USD");
  assert.equal(resolveAccountCurrency(map, "Bank Konvensional"), "IDR");
  // kunci tak dikenal dari peta -> tetap fallback IDR (bukan undefined)
  assert.equal(resolveAccountCurrency(map, "Tidak Ada"), "IDR");
});

test("resolveAccountCurrency: currencies null/undefined/object kosong -> IDR (fallback aman)", () => {
  assert.equal(resolveAccountCurrency(null, "Tabungan USD"), "IDR");
  assert.equal(resolveAccountCurrency(undefined, "Tabungan USD"), "IDR");
  assert.equal(resolveAccountCurrency({}, "Tabungan USD"), "IDR");
  assert.equal(resolveAccountCurrency({}, undefined), "IDR");
  assert.equal(resolveAccountCurrency(undefined, undefined), "IDR");
});

test("resolveAccountCurrency: tidak mengubah nilai kosong; kunci kosong -> IDR", () => {
  // nilai '' (string kosong) diperlakukan falsy -> fallback IDR
  assert.equal(resolveAccountCurrency({ "Akun": "" }, "Akun"), "IDR");
  // akun tidak ditemukan tapi peta berisi kunci lain -> IDR
  assert.equal(resolveAccountCurrency({ "Lain": "USD" }, "Akun"), "IDR");
});

test("accountCurrencyCtx: menyediakan resolver untuk DI", () => {
  const ctx = accountCurrencyCtx();
  assert.equal(typeof ctx.resolveAccountCurrency, "function");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __accountCurrency (produksi)
// ============================================================================
test("KONSISTENSI: resolveAccountCurrency modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const maps = [null, undefined, {}, { "Tabungan USD": "USD" }, { "A": "EUR", "B": "IDR" }, { "X": "" }];
  const akuns = [undefined, null, "", "Tabungan USD", "A", "B", "X", "Z"];
  for (const map of maps) {
    for (const akun of akuns) {
      assert.equal(
        resolveAccountCurrency(map, akun),
        monolithFns.resolveAccountCurrency(map, akun),
        `resolveAccountCurrency(${JSON.stringify(map)}, ${JSON.stringify(akun)})`
      );
    }
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __accountCurrency + delegator global
// ============================================================================
test("WIRING: app.src.js punya __accountCurrency + adoptAccountCurrencyModule + delegasi", () => {
  assert.match(MONOLITH_SRC, /let __accountCurrency\s*=/);
  assert.match(MONOLITH_SRC, /function adoptAccountCurrencyModule\s*\(/);
  assert.match(MONOLITH_SRC, /__accountCurrency\s*=\s*servicesModule\.accountCurrencyCtx\(\)/);
  assert.match(MONOLITH_SRC, /adoptAccountCurrencyModule\(\)/);
  // delegator global getAccountCurrency harus meneruskan appSettings.account_currencies ke modul
  const fnSrc = (MONOLITH_SRC.match(/function\s+getAccountCurrency\s*\([^)]*\)\s*\{([^}]*)\}/) || [])[1] || "";
  assert.match(fnSrc, /__accountCurrency\.resolveAccountCurrency/, "delegasi getAccountCurrency -> __accountCurrency tidak ditemukan");
  assert.match(fnSrc, /appSettings\.account_currencies/, "delegator getAccountCurrency harus meneruskan appSettings.account_currencies");
});

test("WIRING: servicesModule mengekspos accountCurrencyCtx (index.html import + bag)", () => {
  const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(INDEX, /import \{ accountCurrencyCtx \} from ['"].*account-currency\.js/);
  assert.match(INDEX, /accountCurrencyCtx\s*,/);
});
