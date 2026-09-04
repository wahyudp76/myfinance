import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bankWalletDatabase, detectAutoAccountIcon, bankIconCtx } from "../../src/domain/bank-icons.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak objek DEFAULT __bankIcon dari app.src.js ----------
// Sejak v81, implementasi monolit asli dipertahankan sebagai DEFAULT di `__bankIcon`
// (objek top-level: { bankWalletDatabase, detectAutoAccountIcon }), dan fungsi global
// detectAutoAccountIcon menjadi delegasi tipis. Kita ekstrak seluruh IIFE agar
// `db` (array lokal di dalam IIFE) ikut tersedia saat mengeksekusi default-nya.
function extractBankIconDefault() {
  const start = MONOLITH_SRC.indexOf("let __bankIcon = ");
  assert.ok(start >= 0, "Blok default __bankIcon tidak ditemukan di app.src.js -- kontrak berubah?");
  const anchor = "})();\nfunction adoptBankIconModule()";
  const end = MONOLITH_SRC.indexOf(anchor, start);
  assert.ok(end > start, "Penutup blok default __bankIcon tidak ditemukan -- kontrak berubah?");
  // Ambil SELURUH IIFE termasuk penutup `})();` (end + 4 melewati anchor).
  const expr = MONOLITH_SRC.slice(start + "let __bankIcon = ".length, end + 4).trim();
  const obj = Function(`"use strict"; return ${expr};`)();
  assert.ok(obj && typeof obj.detectAutoAccountIcon === "function", "DEFAULT __bankIcon.detectAutoAccountIcon bukan fungsi");
  assert.ok(Array.isArray(obj.bankWalletDatabase), "DEFAULT __bankIcon.bankWalletDatabase bukan array");
  return obj;
}

const monolithDefault = { extractError: null };
try {
  const def = extractBankIconDefault();
  monolithDefault.bankWalletDatabase = def.bankWalletDatabase;
  monolithDefault.detectAutoAccountIcon = def.detectAutoAccountIcon;
} catch (e) {
  monolithDefault.extractError = e;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================
test("bankWalletDatabase: daftar bank/e-wallet/aset lengkap & konsisten strukturnya", () => {
  assert.ok(Array.isArray(bankWalletDatabase));
  assert.ok(bankWalletDatabase.length >= 20);
  for (const item of bankWalletDatabase) {
    assert.equal(typeof item.name, "string");
    assert.ok(["Bank", "E-Wallet", "Investasi"].includes(item.category), `kategori tak dikenal: ${item.name}`);
    assert.ok(Array.isArray(item.keywords) && item.keywords.length > 0);
    // Setiap item harus punya url ATAU (badge + color) -- sumber logo/badge tunggal.
    const hasUrl = typeof item.url === "string" && item.url.length > 0;
    const hasBadge = typeof item.badge === "string" && typeof item.color === "string";
    assert.ok(hasUrl || hasBadge, `item tanpa url/badge: ${item.name}`);
    assert.ok(!(hasUrl && hasBadge), `item punya url DAN badge (harus salah satu): ${item.name}`);
  }
});

test("detectAutoAccountIcon: null/empty -> null", () => {
  assert.equal(detectAutoAccountIcon(null), null);
  assert.equal(detectAutoAccountIcon(""), null);
  assert.equal(detectAutoAccountIcon(undefined), null);
});

test("detectAutoAccountIcon: nama tunai/cash -> ikon uang; investasi/saham/reksadana -> chart", () => {
  assert.deepEqual(detectAutoAccountIcon("Kas Tunai"), { type: "icon-plain", value: "fa-money-bill-wave", color: "text-emerald-500" });
  assert.deepEqual(detectAutoAccountIcon("Cash"), { type: "icon-plain", value: "fa-money-bill-wave", color: "text-emerald-500" });
  assert.deepEqual(detectAutoAccountIcon("Investasi"), { type: "icon-plain", value: "fa-chart-line", color: "text-purple-600" });
  assert.deepEqual(detectAutoAccountIcon("Saham"), { type: "icon-plain", value: "fa-chart-line", color: "text-purple-600" });
  assert.deepEqual(detectAutoAccountIcon("Reksadana"), { type: "icon-plain", value: "fa-chart-line", color: "text-purple-600" });
});

test("detectAutoAccountIcon: kunci paling panjang menang (BCA vs mandiri vs bank jago)", () => {
  // "bank jago" (9) > "jago" (4); "central asia" (12) > "bca" (3).
  const jago = detectAutoAccountIcon("Bank Jago");
  assert.equal(jago.type, "image");
  assert.equal(jago.value, "icons/banks/jago.svg");
  assert.equal(jago.alt, "Bank Jago");
  const bca = detectAutoAccountIcon("BCA Central Asia");
  assert.equal(bca.value, "icons/banks/bca.svg");
  // Badge platform investasi
  const bibit = detectAutoAccountIcon("Rekdana Bibit");
  assert.deepEqual(bibit, { type: "badge", value: "BB", color: "bg-green-600" });
  // "kripto" (6) lebih panjang dari "pintu" (5) -> Indodax menang utk "Pintu Kripto".
  const pintu = detectAutoAccountIcon("Pintu");
  assert.deepEqual(pintu, { type: "badge", value: "PT", color: "bg-slate-900" });
});

test("detectAutoAccountIcon: case-insensitive & ambiguitas kripto dipecah ke badge terpanjang", () => {
  // "kripto" ada di Indodax/Tokocrypto/Pintu; nama spesifik platform menang.
  const indodax = detectAutoAccountIcon("INDODAX");
  assert.deepEqual(indodax, { type: "badge", value: "ID", color: "bg-blue-600" });
  const toko = detectAutoAccountIcon("Tokocrypto");
  assert.deepEqual(toko, { type: "badge", value: "TC", color: "bg-blue-400" });
  // kata "kripto" polos --> Indodax (karena urutan & kata kunci sama panjang) -- konsisten dgn monolit.
  const plain = detectAutoAccountIcon("Akun Kripto");
  assert.ok(plain && plain.type === "badge");
});

test("detectAutoAccountIcon: nama tak dikenal -> null (fallback ikon netral)", () => {
  assert.equal(detectAutoAccountIcon("Bank Nusantara XYZ"), null);
  assert.equal(detectAutoAccountIcon("Dompet Sekolah"), null);
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __bankIcon (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: bankWalletDatabase modul == DEFAULT __bankIcon (konten sama)", () => {
  if (monolithDefault.extractError) throw monolithDefault.extractError;
  assert.equal(bankWalletDatabase.length, monolithDefault.bankWalletDatabase.length);
  for (let i = 0; i < bankWalletDatabase.length; i++) {
    assert.deepEqual(bankWalletDatabase[i], monolithDefault.bankWalletDatabase[i], `item #${i}`);
  }
});

test("KONSISTENSI: detectAutoAccountIcon modul == monolit app.src.js", () => {
  if (monolithDefault.extractError) throw monolithDefault.extractError;
  const cases = [null, "", undefined, "Kas Tunai", "Cash", "Bank Jago", "BCA Central Asia", "Rekdana Bibit", "INDODAX", "Akun Kripto", "Bank Nusantara XYZ", "OVO", "GoPay"];
  for (const name of cases) {
    assert.deepEqual(detectAutoAccountIcon(name), monolithDefault.detectAutoAccountIcon(name), `detectAutoAccountIcon(${JSON.stringify(name)})`);
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __bankIcon + delegator global
// ============================================================================
test("WIRING: app.src.js punya __bankIcon + adoptBankIconModule + delegasi ke modul", () => {
  assert.match(MONOLITH_SRC, /let __bankIcon\s*=/);
  assert.match(MONOLITH_SRC, /function adoptBankIconModule\s*\(/);
  assert.match(MONOLITH_SRC, /__bankIcon\s*=\s*servicesModule\.bankIconCtx\(\)/);
  assert.match(MONOLITH_SRC, /bankWalletDatabase\s*=\s*__bankIcon\.bankWalletDatabase/);
  // delegator global detectAutoAccountIcon harus meneruskan ke __bankIcon
  const fnSrc = (MONOLITH_SRC.match(/function\s+detectAutoAccountIcon\s*\([^)]*\)\s*\{([^}]*)\}/) || [])[1] || "";
  assert.match(fnSrc, /__bankIcon\.detectAutoAccountIcon/, "delegasi detectAutoAccountIcon -> __bankIcon tidak ditemukan");
});

test("WIRING: servicesModule mengekspos bankIconCtx (index.html import + bag)", () => {
  assert.match(MONOLITH_SRC, /adoptBankIconModule\(\)/);
  // index.html harus meng-import bankIconCtx & memasukkannya ke __myfinanceServices
  const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(INDEX, /import \{ bankIconCtx \} from ['"].*bank-icons\.js/);
  assert.match(INDEX, /bankIconCtx\s*,/);
});

test("bankIconCtx: menyediakan deteksi + data untuk DI", () => {
  const ctx = bankIconCtx();
  assert.equal(typeof ctx.detectAutoAccountIcon, "function");
  assert.equal(ctx.bankWalletDatabase, bankWalletDatabase);
});
