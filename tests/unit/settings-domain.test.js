import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneAccountKeyedMaps, ACCOUNT_KEYED_SETTINGS_MAPS } from "../../src/domain/settings.js";

// Regresi: removeSetting('accounts', i) di index.html dulu HANYA membersihkan
// appSettings.accountIcons saat sebuah akun dihapus -- appSettings.account_currencies untuk
// nama akun yang sama TIDAK ikut dibuang. Kalau nanti user bikin akun baru dengan nama PERSIS
// SAMA dengan akun lama yang sudah dihapus, akun baru itu diam-diam kewarisan currency akun
// lama (getAccountCurrency() membaca peta yang masih ada entrinya). Alur rename di
// submitAccountModal() sudah benar (membersihkan keduanya) -- makanya sekarang keduanya pakai
// fungsi murni yang sama ini, supaya tidak bisa divergen lagi.

test("pruneAccountKeyedMaps: menghapus entri dari SEMUA peta yang di-key nama akun", () => {
  const appSettings = {
    accountIcons: { "Rekening USD": { type: "icon", value: "fa-university" }, "Cash": { type: "icon", value: "fa-wallet" } },
    account_currencies: { "Rekening USD": "USD" },
  };

  const hadEntry = pruneAccountKeyedMaps(appSettings, "Rekening USD");

  assert.deepEqual(hadEntry, { accountIcons: true, account_currencies: true });
  assert.equal("Rekening USD" in appSettings.accountIcons, false);
  assert.equal("Rekening USD" in appSettings.account_currencies, false);
  // Akun lain (Cash) tidak boleh ikut kena.
  assert.equal(appSettings.accountIcons["Cash"].value, "fa-wallet");
});

test("pruneAccountKeyedMaps: akun baru dengan nama sama TIDAK lagi mewarisi currency akun lama yang sudah dihapus", () => {
  // Simulasi urutan kejadian nyata: akun "Rekening USD" (currency USD) dihapus, lalu user
  // bikin akun BARU dengan nama sama persis, dimaksudkan sebagai akun IDR biasa.
  const appSettings = { account_currencies: { "Rekening USD": "USD" } };
  pruneAccountKeyedMaps(appSettings, "Rekening USD");

  // getAccountCurrency() di index.html: (appSettings.account_currencies?.[akun]) || 'IDR'
  const currencyForNewAccount = appSettings.account_currencies["Rekening USD"] || "IDR";
  assert.equal(currencyForNewAccount, "IDR");
});

test("pruneAccountKeyedMaps: hadEntry false kalau memang tidak ada entri sebelumnya (bukan error)", () => {
  const appSettings = { accountIcons: {}, account_currencies: {} };
  const hadEntry = pruneAccountKeyedMaps(appSettings, "Akun Baru");
  assert.deepEqual(hadEntry, { accountIcons: false, account_currencies: false });
});

test("pruneAccountKeyedMaps: tidak error kalau peta belum pernah diinisialisasi sama sekali", () => {
  const appSettings = {}; // belum ada accountIcons / account_currencies sama sekali
  const hadEntry = pruneAccountKeyedMaps(appSettings, "Cash");
  assert.deepEqual(hadEntry, { accountIcons: false, account_currencies: false });
});

test("ACCOUNT_KEYED_SETTINGS_MAPS mendaftar persis 2 peta yang dikenal saat ini", () => {
  assert.deepEqual(ACCOUNT_KEYED_SETTINGS_MAPS, ["accountIcons", "account_currencies"]);
});
