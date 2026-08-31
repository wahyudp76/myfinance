// GUARD: aset lokal yang di-serve service worker tidak boleh berubah tanpa
// bump CACHE_VERSION di sw.js. Latar: bug nyata 2026-08-31 -- perbaikan chart
// proporsi (src/ui/categories.js) ter-commit TANPA bump versi; sw.js byte-
// identik -> update check tidak terpicu -> pengguna terkunci di bundle lama
// (label chart tumpang tindih) walau reload berkali-kali.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSwAssetHash } from "./sw-cache-hash-helper.mjs";

test("aset SW: hash snapshot cocok (aset berubah => WAJIB bump CACHE_VERSION)", async () => {
  const { version, hash, fileCount } = await computeSwAssetHash();
  const snap = readFileSync(new URL("./sw-cache.snapshot", import.meta.url), "utf8");
  const snapVersion = snap.match(/version=(\S+)/)?.[1];
  const snapHash = snap.match(/hash=(\S+)/)?.[1];
  assert.ok(fileCount > 40, `jumlah aset ter-hash wajar (>40), didapat ${fileCount}`);
  if (snapHash !== hash || snapVersion !== version) {
    assert.fail(
      `Aset lokal SW berubah tanpa bump CACHE_VERSION (snapshot: v${snapVersion}/${snapHash?.slice(0, 12)}… vs sekarang: v${version}/${hash.slice(0, 12)}…). ` +
      `Naikkan CACHE_VERSION di sw.js (mis. ${snapVersion} -> myfinance-v${+snapVersion.split("-v")[1] + 1}) supaya service worker pengguna ter-update, ` +
      `lalu jalankan: node tests/unit/update-sw-cache-snapshot.mjs`
    );
  }
});
