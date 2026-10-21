// Unit test src/domain/tx-sort.js (v141) + parseTglMs di src/domain/dates.js.
// Jaminan intinya: urutan hasil HARUS identik dengan [...rows].sort(txServerCompare)
// -- pembanding lama tetap jadi acuan, disalin apa adanya di bawah.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortTxRowsDesc } from "../../src/domain/tx-sort.js";
import { parseTgl, parseTglMs } from "../../src/domain/dates.js";

// Salinan persis txServerCompare (app.src.js) sebagai acuan kebenaran.
const txCreatedAtMs = (row) => {
  if (row && row.created_at != null) {
    const t = Date.parse(row.created_at);
    if (!Number.isNaN(t)) return t;
  }
  return -Infinity;
};
const txServerCompare = (a, b) => {
  const diffDate = parseTgl(b.tanggal) - parseTgl(a.tanggal);
  if (diffDate !== 0) return diffDate;
  const diffCt = txCreatedAtMs(b) - txCreatedAtMs(a);
  if (diffCt !== 0) return diffCt;
  const ia = String(a.id || "");
  const ib = String(b.id || "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};
const deps = { tanggalMs: parseTglMs, createdAtMs: txCreatedAtMs };
const referensi = (rows) => [...rows].sort(txServerCompare).map((r) => r.id);
const hasil = (rows) => sortTxRowsDesc(rows, deps).map((r) => r.id);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buatBaris(n, seed, { banyakTanggal = 730, tanpaCreatedAt = 0 } = {}) {
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(2025, 0, 1 + Math.floor(r() * banyakTanggal));
    const tanggal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const row = { id: `id-${i.toString().padStart(6, "0")}-${Math.floor(r() * 1e6).toString(36)}`, tanggal, jumlah: Math.floor(r() * 1e6) };
    if (i >= tanpaCreatedAt || tanpaCreatedAt === 0) row.created_at = `${tanggal}T${String(Math.floor(r() * 24)).padStart(2, "0")}:15:00Z`;
    rows.push(row);
  }
  return rows;
}

test("tx-sort: identik dengan sort penuh txServerCompare (acak deterministik)", () => {
  for (const seed of [1, 5, 42, 1337]) {
    for (const n of [0, 1, 2, 3, 17, 64, 200, 1000]) {
      const rows = buatBaris(n, seed);
      assert.deepEqual(hasil(rows), referensi(rows), `beda pada seed=${seed} n=${n}`);
    }
  }
});

test("tx-sort: tanggal kembar semua (hanya created_at & id yang membedakan)", () => {
  const rows = buatBaris(400, 7, { banyakTanggal: 1 });
  assert.deepEqual(hasil(rows), referensi(rows));
});

test("tx-sort: created_at hilang -> -Infinity (tetap di belakang yang punya)", () => {
  const rows = buatBaris(50, 11, { tanpaCreatedAt: 25 });
  assert.deepEqual(hasil(rows), referensi(rows));
  assert.ok(rows.slice(0, 25).every((r) => r.created_at === undefined), "sanity: 25 baris pertama tanpa created_at");
  assert.ok(rows.slice(25).every((r) => typeof r.created_at === "string"), "sanity: sisanya punya created_at");
});

test("tx-sort: tanggal tidak sah / kosong tidak melempar dan tetap konsisten", () => {
  const rows = [
    { id: "a", tanggal: "2026-05-05", created_at: "2026-05-05T10:00:00Z" },
    { id: "b", tanggal: null, created_at: null },
    { id: "c", tanggal: "bukan-tanggal", created_at: "juga-bukan" },
    { id: "d", tanggal: "2026-05-06", created_at: "2026-05-06T10:00:00Z" },
    { id: "e" },
  ];
  assert.deepEqual(hasil(rows), referensi(rows));
});

test("tx-sort: tidak mengubah array masukan dan tidak berbagi referensi", () => {
  const rows = buatBaris(60, 3);
  const sebelum = rows.map((r) => r.id).join("|");
  const out = sortTxRowsDesc(rows, deps);
  assert.equal(rows.map((r) => r.id).join("|"), sebelum, "array masukan terurut ulang");
  out[0] = null;
  assert.ok(rows.every(Boolean), "menimpa hasil merusak masukan");
  assert.equal(out.length, 60);
});

test("tx-sort: id angka & id hilang diperlakukan seperti pembanding lama", () => {
  const rows = [
    { id: 12, tanggal: "2026-01-02", created_at: "2026-01-02T01:00:00Z" },
    { id: 9, tanggal: "2026-01-02", created_at: "2026-01-02T01:00:00Z" },
    { id: null, tanggal: "2026-01-02", created_at: "2026-01-02T01:00:00Z" },
    { id: "100", tanggal: "2026-01-02", created_at: "2026-01-02T01:00:00Z" },
  ];
  assert.deepEqual(hasil(rows), referensi(rows));
});

test("parseTglMs: konsisten dengan parseTgl, termasuk kasus kosong & tidak sah", () => {
  for (const s of ["2026-09-25", "2025-01-01", "2026-09-25T13:45:00Z", "", null, undefined, "abc"]) {
    const viaObjek = parseTgl(s).getTime();
    const viaMs = parseTglMs(s);
    if (Number.isNaN(viaObjek)) assert.ok(Number.isNaN(viaMs), `NaN diharapkan untuk ${String(s)}`);
    else assert.equal(viaMs, viaObjek, `beda untuk ${String(s)}`);
  }
});

// ---------------------------------------------------------------------------
// v141: seleksi jendela berbasis kunci harus identik dengan
// selectSortedWindow(rows, txServerCompare, ...) -- algoritmanya sama, hanya
// kuncinya yang dihitung lebih awal.
// ---------------------------------------------------------------------------
import { selectWindowDesc } from "../../src/domain/tx-sort.js";
import { selectSortedWindow } from "../../src/domain/tx-window.js";

test("selectWindowDesc: identik dengan selectSortedWindow + txServerCompare", () => {
  for (const seed of [2, 9, 77]) {
    for (const n of [0, 1, 5, 17, 64, 300]) {
      const rows = buatBaris(n, seed);
      for (const size of [1, 10]) {
        for (const start of [0, 3, Math.max(0, n - size)]) {
          const a = selectWindowDesc(rows, deps, start, size).map((r) => r.id);
          const b = selectSortedWindow(rows, txServerCompare, start, size).map((r) => r.id);
          assert.deepEqual(a, b, `beda seed=${seed} n=${n} start=${start} size=${size}`);
        }
      }
    }
  }
});

test("selectWindowDesc: batas aman & tidak mengubah masukan", () => {
  const rows = buatBaris(40, 4);
  const sebelum = rows.map((r) => r.id).join("|");
  assert.deepEqual(selectWindowDesc([], deps, 0, 10), []);
  assert.deepEqual(selectWindowDesc(rows, deps, 40, 10), []);
  assert.deepEqual(selectWindowDesc(rows, deps, 0, 0), []);
  assert.deepEqual(
    selectWindowDesc(rows, deps, 35, 99).map((r) => r.id),
    selectSortedWindow(rows, txServerCompare, 35, 99).map((r) => r.id),
  );
  assert.equal(rows.map((r) => r.id).join("|"), sebelum, "array masukan berubah");
});
