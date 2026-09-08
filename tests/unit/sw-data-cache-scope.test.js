// GUARD BUG PERAWATAN 2026-09-08 (v100): scope cache data offline.
//
// Bug yang dijaga: sw.js dulu menghitung namespace cache data dari
// `auth.slice(-24)` -- 24 karakter terakhir header Authorization. Pada JWT
// Supabase itu ekor TANDA TANGAN, yang berubah SETIAP token di-refresh (default
// tiap jam). Dua akibat yang sudah dibuktikan lewat E2E (scripts/verify-offline-cache.mjs):
//   1. entri cache untuk user yang SAMA berlipat tiap refresh (8 -> 16 -> 24 ...)
//      dan tidak pernah dibuang, karena DATA_CACHE sengaja tidak ikut dihapus
//      saat CACHE_VERSION naik;
//   2. offline tepat setelah refresh token = cache MISS = "Gagal memuat data".
//
// Fungsi dataCacheScope() DIEKSTRAK dari sw.js apa adanya lalu diuji perilakunya,
// bukan disalin ke sini -- kalau sw.js diubah, tes ini ikut menguji versi barunya.
// (sw.js adalah service worker classic, tidak bisa di-import sebagai modul.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");

function ambilFungsi(nama) {
  const mulai = sw.indexOf(`function ${nama}(`);
  assert.notEqual(mulai, -1, `function ${nama}() harus ada di sw.js`);
  // cari kurung kurawal seimbang
  const i = sw.indexOf("{", mulai);
  let dalam = 0;
  for (let j = i; j < sw.length; j += 1) {
    if (sw[j] === "{") dalam += 1;
    else if (sw[j] === "}") {
      dalam -= 1;
      if (dalam === 0) return sw.slice(mulai, j + 1);
    }
  }
  throw new Error(`kurung fungsi ${nama} tidak seimbang`);
}

const dataCacheScope = new Function(`${ambilFungsi("dataCacheScope")}; return dataCacheScope;`)();

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload, signature) => `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.${signature}`;

const SUB_A = "11111111-2222-3333-4444-555555555555";
const SUB_B = "99999999-8888-7777-6666-555555555555";

test("scope diambil dari klaim sub, bukan potongan token", () => {
  assert.equal(dataCacheScope(`Bearer ${jwt({ sub: SUB_A, exp: 9999999999 }, "tandatangan-apa-pun")}`), SUB_A);
});

test("REGRESI: refresh token pada akun yang SAMA menghasilkan scope yang SAMA", () => {
  // Persis skenario dunia nyata: payload boleh beda (iat/exp baru) dan tanda
  // tangan pasti beda, tapi `sub` tetap. Dulu ini menghasilkan dua namespace.
  const sebelum = dataCacheScope(`Bearer ${jwt({ sub: SUB_A, iat: 1000, exp: 4600 }, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")}`);
  const sesudah = dataCacheScope(`Bearer ${jwt({ sub: SUB_A, iat: 4600, exp: 8200 }, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")}`);
  assert.equal(sebelum, sesudah, "refresh token TIDAK boleh melahirkan namespace cache baru");
  assert.equal(sebelum, SUB_A);
});

test("dua akun berbeda tetap terpisah (tujuan keamanan asli tidak hilang)", () => {
  const a = dataCacheScope(`Bearer ${jwt({ sub: SUB_A }, "sig")}`);
  const b = dataCacheScope(`Bearer ${jwt({ sub: SUB_B }, "sig")}`);
  assert.notEqual(a, b);
});

test("payload base64url dengan karakter - dan _ tetap terbaca", () => {
  // Cari payload yang encoding base64url-nya benar-benar memuat '-' atau '_'.
  let payload = null;
  for (let i = 0; i < 500; i += 1) {
    const kandidat = { sub: `user-${i}`, nama: `Budi~Ω${i}?>` };
    if (/[-_]/.test(b64url(kandidat))) { payload = kandidat; break; }
  }
  assert.ok(payload, "harus menemukan payload uji yang memuat - atau _");
  assert.equal(dataCacheScope(`Bearer ${jwt(payload, "sig")}`), payload.sub);
});

test("payload UTF-8 non-ASCII tidak merusak decoder", () => {
  const sub = "pengguna-ÑÜ-日本-🚀";
  assert.equal(dataCacheScope(`Bearer ${jwt({ sub }, "sig")}`), sub);
});

test("token rusak / bukan JWT tidak melempar, jatuh ke cadangan", () => {
  for (const buruk of ["", "Bearer ", "Bearer bukan-jwt", "Bearer a.b", "Bearer a.!!!.c", null, undefined]) {
    assert.doesNotThrow(() => dataCacheScope(buruk), `input ${JSON.stringify(buruk)} tidak boleh melempar`);
    assert.equal(typeof dataCacheScope(buruk), "string");
  }
});

test("JWT tanpa klaim sub jatuh ke cadangan, bukan string kosong", () => {
  const t = jwt({ role: "anon" }, "ekor-tanda-tangan-yang-panjang");
  const hasil = dataCacheScope(`Bearer ${t}`);
  assert.ok(hasil.length > 0, "scope cadangan tidak boleh kosong");
  assert.ok(t.endsWith(hasil), "cadangan memakai ekor token seperti perilaku lama");
});

test("prefiks 'Bearer ' opsional dan tidak ikut masuk scope", () => {
  const t = jwt({ sub: SUB_A }, "sig");
  assert.equal(dataCacheScope(t), SUB_A);
  assert.equal(dataCacheScope(`Bearer ${t}`), SUB_A);
  assert.equal(dataCacheScope(`bearer ${t}`), SUB_A);
});

test("sw.js TIDAK lagi memakai auth.slice(-24) sebagai scope cache", () => {
  const blok = sw.slice(sw.indexOf("if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')"));
  assert.ok(
    !/const scope = encodeURIComponent\(auth\.slice\(-24\)\)/.test(blok),
    "scope berbasis potongan tanda tangan token sudah terbukti bikin cache tumbuh tanpa batas"
  );
  assert.ok(/const scope = encodeURIComponent\(dataCacheScope\(auth\)\)/.test(blok));
});

test("penulisan cache data dibatasi jumlahnya (putDataCacheBounded)", () => {
  assert.ok(/const DATA_CACHE_MAX = \d+;/.test(sw), "harus ada batas atas entri cache data");
  const maks = Number(sw.match(/const DATA_CACHE_MAX = (\d+);/)[1]);
  assert.ok(maks >= 20 && maks <= 500, `DATA_CACHE_MAX tidak masuk akal: ${maks}`);
  assert.ok(
    /caches\.open\(DATA_CACHE\)\.then\(\(cache\) => putDataCacheBounded\(cache, key, copy\)\)/.test(sw),
    "penulisan cache data harus lewat putDataCacheBounded, bukan cache.put langsung"
  );
  const fn = ambilFungsi("putDataCacheBounded");
  assert.ok(fn.includes("cache.delete(keys[i])"), "harus benar-benar membuang entri terlama");
});

test("DATA_CACHE dinaikkan ke v2 supaya sampah lama ikut dibersihkan sekali", () => {
  assert.match(sw, /const DATA_CACHE = 'myfinance-data-v2';/);
  // Pembersih di activate membuang semua cache selain CACHE_VERSION & DATA_CACHE,
  // jadi 'myfinance-data-v1' otomatis kena. Pastikan filter itu masih utuh.
  assert.ok(
    /names\.filter\(\(n\) => n !== CACHE_VERSION && n !== DATA_CACHE\)/.test(sw),
    "filter pembersih cache di activate harus tetap ada supaya v1 benar-benar terhapus"
  );
});
