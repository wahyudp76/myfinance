// GUARD REGRESI v68 (optimasi sinkronisasi loadData) -- guard statis di app.src.js.
// Latar: v68 memindahkan gerbang chart lazy (`await window.__mfChartLibReady`) dari
// DEPAN fetch 6 tabel ke belakangnya, supaya unduhan chart.js (204KB) tidak lagi
// duduk di jalur kritis sinkronisasi (fetch data baru mulai setelah chart lib tuntas
// = serial). Fetch kini di-const-kan sebagai `syncFetch` (langsung dibuat di awal
// loadData), dan gerbang chart hanya menahan RENDER.
//
// Kalau suatu saat urutan ini dirombak ulang dan salah satu invariant di bawah
// hilang, test ini MERAH -- regresi "sync lama lagi" ketahuan di CI, bukan di HP
// pemilik setelah deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const src = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// Iris tubuh loadData dari deklarasi sampai .catch penutup (pencarian dari
// deklarasi pertama; kalau ada fungsi lain bernama mirip setelahnya tidak
// memengaruhi karena kita potong sampai catch terdekat di bawah syncFetch.then).
function sliceBetween(a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  if (i === -1 || j === -1) return null;
  return src.slice(i, j);
}

test("v68: fetch 6 tabel (syncFetch) dibuat SEBELUM gerbang chart lib di loadData", () => {
  const syncStart = src.indexOf("const syncFetch = (async () => {");
  // Cari KODE gerbang (bukan komentar -- beberapa komentar menyebut teks yang sama).
  const gateCode = "if (window.__mfChartLibReady) { try { await window.__mfChartLibReady; } catch (e) {} }";
  const gate = src.indexOf(gateCode);
  assert.ok(syncStart !== -1, "const syncFetch harus ada di app.src.js");
  assert.ok(gate !== -1, "kode gerbang chart lib (await window.__mfChartLibReady) harus ada");
  assert.ok(
    syncStart < gate,
    "syncFetch (mulai tarik data) harus dibuat SEBELUM await chart lib -- kalau tidak, unduhan chart.js memblokir sinkronisasi (regresi v68)"
  );
  // Gerbang chart harus berada di ANTARA pembuatan syncFetch dan penempelan .then
  const between = src.slice(syncStart, src.indexOf("syncFetch.then((response) => {", syncStart));
  assert.ok(
    between.includes("await window.__mfChartLibReady"),
    "gerbang chart lib harus berada di antara pembuatan syncFetch dan syncFetch.then (hanya menahan render)"
  );
});

test("v68: data budgets bulan berjalan dipakai ulang (bukan refetch ganda) saat bulan sama", () => {
  const chain = sliceBetween("syncFetch.then((response) => {", ".catch((err) => {");
  assert.ok(chain, "rantai syncFetch.then harus ada");
  assert.ok(
    chain.includes("if (targetBulan === currentMonthStr()) {"),
    "loadData harus memakai ulang response.budgets sebagai currentMonthBudgetsCache saat targetBulan = bulan berjalan (hemat 1 request REST per sinkronisasi)"
  );
  assert.ok(
    chain.includes("currentMonthBudgetsCache = (response.budgets &&"),
    "cache bulan berjalan harus di-seed dari response.budgets hasil syncFetch"
  );
});
