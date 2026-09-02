import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneAccountKeyedMaps, ACCOUNT_KEYED_SETTINGS_MAPS, sanitizeIconOverride, sanitizeSettingsIconOverrides, isSafeClassToken, isSafeFaIconToken, isSafeIconImageUrl } from "../../src/domain/settings.js";

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

// ============================================================================
// Keamanan bentuk override ikon/gaya (v60): accountIcons & categoryStyles bisa
// sampai ke state dari sumber tak sepenuhnya tepercaya (restore backup JSON /
// tabel cloud custom_icons) lalu dirender ke innerHTML (atribut src/class &
// teks badge). Bentuk di luar pola sah harus ditolak/dibuang, bentuk sah
// (upload modal -> data URL, logo bank internal, palet -> token FA/Tailwind,
// badge huruf) harus tetap diterima apa adanya.
// ============================================================================

test("isSafeIconImageUrl: data URL gambar raster/base64 & path logo bank internal SAH", () => {
  assert.equal(isSafeIconImageUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg=="), true);
  assert.equal(isSafeIconImageUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE="), true);
  assert.equal(isSafeIconImageUrl("data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEALmk0mk0iIiIiIg=="), true);
  assert.equal(isSafeIconImageUrl("data:image/gif;base64,R0lGODlhAQABAAAAACw="), true);
  // svg+xml data URL DIPERBOLEHKAN: dalam konteks <img src> svg bersifat pasif
  // (skrip di dalamnya tidak dieksekusi browser) -- ini bukan vector eksekusi.
  assert.equal(isSafeIconImageUrl("data:image/svg+xml;base64,PHN2Zy8+"), true);
  assert.equal(isSafeIconImageUrl("icons/banks/bca.svg"), true);
  assert.equal(isSafeIconImageUrl("icons/banks/bni.png"), true);
});

test("isSafeIconImageUrl: URL/teks mencurigakan DITOLAK", () => {
  assert.equal(isSafeIconImageUrl('x" onerror="alert(1)'), false);
  assert.equal(isSafeIconImageUrl("https://evil.example/x.png"), false);
  assert.equal(isSafeIconImageUrl('data:image/svg+xml;utf8,<svg onload="alert(1)">'), false);
  // svg+xml BASE64 tetap diterima (inert di <img>), bentuk data URL lain di luar pola DITOLAK
  assert.equal(isSafeIconImageUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E"), false);
  assert.equal(isSafeIconImageUrl("data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"), true);
  assert.equal(isSafeIconImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeIconImageUrl(123), false);
  assert.equal(isSafeIconImageUrl(null), false);
  assert.equal(isSafeIconImageUrl(""), false);
});

test("isSafeClassToken / isSafeFaIconToken: token Tailwind & FA sah, markup/quotes ditolak", () => {
  assert.equal(isSafeClassToken("bg-amber-100"), true);
  assert.equal(isSafeClassToken("text-emerald-600"), true);
  assert.equal(isSafeClassToken("text-white"), true);
  assert.equal(isSafeClassToken('bg-red-500" onclick="x'), false);
  assert.equal(isSafeClassToken("bg red"), false); // dua token sekaligus tidak dikenal
  assert.equal(isSafeFaIconToken("fa-wallet"), true);
  assert.equal(isSafeFaIconToken("fa-money-bill-wave"), true);
  assert.equal(isSafeFaIconToken('fa-wallet" onmouseover="x'), false);
  assert.equal(isSafeFaIconToken("fa-wallet onmouseover=x"), false);
});

test("sanitizeIconOverride: bentuk SAH dari modal UI tetap diterima utuh", () => {
  assert.deepEqual(
    sanitizeIconOverride({ type: "icon", value: "fa-building-columns", bg: "bg-blue-100", color: "text-blue-600" }),
    { type: "icon", value: "fa-building-columns", bg: "bg-blue-100", color: "text-blue-600" }
  );
  assert.deepEqual(
    sanitizeIconOverride({ type: "icon", value: "fa-coins" }), // sub kategori tanpa bg/color
    { type: "icon", value: "fa-coins" }
  );
  const img = sanitizeIconOverride({ type: "image", value: "data:image/jpeg;base64,AAAA", alt: "Logo" });
  assert.equal(img.type, "image");
  assert.equal(img.value, "data:image/jpeg;base64,AAAA");
  assert.equal(img.alt, "Logo");
  assert.deepEqual(
    sanitizeIconOverride({ type: "icon-plain", value: "fa-money-bill-wave", color: "text-emerald-500" }),
    { type: "icon-plain", value: "fa-money-bill-wave", color: "text-emerald-500" }
  );
  assert.deepEqual(
    sanitizeIconOverride({ type: "badge", value: "BCA", color: "bg-blue-600" }),
    { type: "badge", value: "BCA", color: "bg-blue-600" }
  );
});

test("sanitizeIconOverride: bentuk direkayasa DITOLAK (null)", () => {
  assert.equal(sanitizeIconOverride(null), null);
  assert.equal(sanitizeIconOverride("icon"), null);
  assert.equal(sanitizeIconOverride({ type: "image", value: 'x" onerror="alert(1)' }), null);
  assert.equal(sanitizeIconOverride({ type: "icon", value: 'fa-wallet" onclick="alert(1)', bg: "bg-white", color: "text-black" }), null);
  assert.equal(sanitizeIconOverride({ type: "icon", value: "fa-wallet", bg: 'bg-white" onclick="x', color: "text-black" }), null);
  assert.equal(sanitizeIconOverride({ type: "icon", value: "fa-wallet", bg: "bg-white", color: 'text-black"><script>' }), null);
  assert.equal(sanitizeIconOverride({ type: "badge", value: "<img src=x onerror=alert(1)>" }), null);
  assert.equal(sanitizeIconOverride({ type: "hacker", value: "x" }), null);
  // alt non-string dinormalisasi jadi "" (alt dirender dgn escapeHtml, tidak pernah mentah)
  assert.deepEqual(sanitizeIconOverride({ type: "image", value: "data:image/jpeg;base64,AAAA", alt: 42 }), { type: "image", value: "data:image/jpeg;base64,AAAA", alt: "" });
});

test("sanitizeIconOverride: alt sangat panjang dipangkas, tidak pernah > 200 karakter", () => {
  const out = sanitizeIconOverride({ type: "image", value: "data:image/png;base64,AAAA", alt: "x".repeat(500) });
  assert.equal(out.alt.length, 200);
});

test("sanitizeSettingsIconOverrides: membuang override mencurigakan dari accountIcons & categoryStyles, menyisakan yang sah", () => {
  const settings = {
    accounts: ["BCA", "Cash"], // bukan urusan fungsi ini -- tidak boleh disentuh
    accountIcons: {
      BCA: { type: "image", value: "data:image/png;base64,iVBORw0=", alt: "BCA" }, // sah -> tetap
      Cash: { type: "icon", value: 'fa-wallet" onerror="alert(1)' }, // direkayasa -> dibuang
    },
    categoryStyles: {
      pengeluaran: {
        Makanan: { type: "icon", value: "fa-utensils", bg: "bg-rose-100", color: "text-rose-500" }, // sah
        Jahat: { type: "image", value: 'x" onerror="alert(1)' }, // dibuang
      },
      pemasukan: {
        Gaji: "bukan-objek", // bentuk tak dikenal -> dibuang
      },
    },
    hidden_categories: { pengeluaran: { parents: ["Utang"] } }, // field lain tidak boleh tersentuh
  };
  sanitizeSettingsIconOverrides(settings);
  assert.deepEqual(settings.accountIcons, {
    BCA: { type: "image", value: "data:image/png;base64,iVBORw0=", alt: "BCA" },
  });
  assert.deepEqual(settings.categoryStyles.pengeluaran, {
    Makanan: { type: "icon", value: "fa-utensils", bg: "bg-rose-100", color: "text-rose-500" },
  });
  assert.deepEqual(settings.categoryStyles.pemasukan, {});
  assert.deepEqual(settings.accounts, ["BCA", "Cash"]);
  assert.deepEqual(settings.hidden_categories, { pengeluaran: { parents: ["Utang"] } });
});

test("sanitizeSettingsIconOverrides: toleran thd settings kosong / tanpa peta ikon", () => {
  assert.equal(sanitizeSettingsIconOverrides(null), null);
  const s = {};
  assert.equal(sanitizeSettingsIconOverrides(s), s);
  const s2 = { accountIcons: {}, categoryStyles: {} };
  sanitizeSettingsIconOverrides(s2);
  assert.deepEqual(s2, { accountIcons: {}, categoryStyles: {} });
});
