// Regresi bug v111: aset lama "Shopee Merchant" memakai kategori legacy
// "Bisnis" yang tidak ada di option form. Akibatnya select required menjadi
// kosong dan perubahan platform/sekuritas tidak pernah lolos submit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const source = readFileSync(resolve(ROOT, "app.src.js"), "utf8");
const build = readFileSync(resolve(ROOT, "app.js"), "utf8");

test("aset: edit mempertahankan kategori legacy yang tidak lagi ada di daftar option", () => {
  assert.match(source, /const kategoriSelect = document\.getElementById\('aset_kategori'\)/);
  assert.match(source, /legacyOption\.value = kategoriValue/);
  assert.match(source, /kategoriSelect\.appendChild\(legacyOption\)/);
  assert.match(build, /data-asset-platform/); // app.js wajib sudah dibangun dari sumber terbaru
});

test("aset: saran platform tidak memakai onmousedown inline yang diblokir CSP", () => {
  assert.match(source, /data-asset-platform=/);
  assert.doesNotMatch(source, /onmousedown=\\"pickAssetBankSuggestion/);
  assert.doesNotMatch(build, /onmousedown=\\"pickAssetBankSuggestion/);
});

test("aset: form kategori tetap required dan platform tetap input yang bisa diedit", () => {
  assert.match(html, /<select id="aset_kategori" required/);
  assert.match(html, /<input type="text" id="aset_platform" required/);
});
