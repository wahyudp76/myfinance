// GUARD REGRESI v70 (perawatan) -- 3 bug nyata yang ditemukan audit 2026-09-04:
//  1. app.src.js initStaticUIListeners: postMessage MYFINANCE_CLEAR_DATA_CACHE ditulis
//     DI LUAR handler klik -> cache data offline (GET /rest/v1) TIDAK PERNAH dibuang
//     saat logout (hanya sekali saat bootstrap, ketika belum ada apa-apa utk dibuang).
//     Fix: clearOfflineDataCache() dipanggil di handler klik DAN di showLoginView().
//  2. sw.js activate: DATA_CACHE ikut terhapus tiap CACHE_VERSION naik (bertentangan
//     dgn komentar "sengaja TIDAK ikut versi"). Fix: dikecualikan dari filter.
//  3. sw.js navigate: respons error (404/503 saat Pages deploy) ikut di-cache sbg
//     fallback offline. Fix: hanya res.ok yang disimpan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const app = readFileSync(resolve(ROOT, "app.src.js"), "utf8");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  if (i === -1 || j === -1) return null;
  return src.slice(i, j);
}

test("v70: clear cache data dipanggil DI DALAM handler klik logout, bukan saat pemasangan listener", () => {
  const fn = sliceBetween(app, "function initStaticUIListeners() {", "function clearOfflineDataCache() {");
  assert.ok(fn, "initStaticUIListeners & clearOfflineDataCache harus ada");
  assert.ok(
    /addEventListener\('click',\s*\(\)\s*=>\s*\{\s*clearOfflineDataCache\(\);/.test(fn),
    "handler klik logout harus memanggil clearOfflineDataCache() lebih dulu"
  );
  assert.ok(!fn.includes("postMessage("), "postMessage tidak boleh lagi ditulis langsung di luar handler");
});

test("v70: showLoginView (jalur logout terpusat) juga membuang cache data", () => {
  const fn = sliceBetween(app, "function showLoginView() {", "function showAppShell() {");
  assert.ok(fn && fn.includes("clearOfflineDataCache();"), "showLoginView harus memanggil clearOfflineDataCache()");
});

test("v70: sw.js activate tidak menghapus DATA_CACHE saat ganti versi", () => {
  const act = sliceBetween(sw, "self.addEventListener('activate'", "self.addEventListener('message'");
  assert.ok(act && act.includes("n !== DATA_CACHE"), "filter penghapusan cache lama harus mengecualikan DATA_CACHE");
});

test("v70: sw.js navigasi hanya men-cache respons OK", () => {
  const nav = sliceBetween(sw, "if (req.mode === 'navigate') {", "// Aset statis lain");
  assert.ok(nav && /if \(res && res\.ok\)/.test(nav), "cache.put untuk navigasi harus dijaga res.ok");
});
