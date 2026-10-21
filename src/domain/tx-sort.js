// src/domain/tx-sort.js — urutkan transaksi (tanggal menurun, created_at
// menurun, id menaik) TANPA membayar biaya pembanding berulang.
//
// KENAPA ADA (audit data 2026-10-21, v141):
// `txServerCompare` (app.src.js) memanggil `parseTgl()` DUA KALI per
// perbandingan. `parseTgl` memang memo timestamp-nya, tetapi setiap panggilan
// tetap membayar: `String(tanggalStr).split("T")[0]` (alokasi string + array),
// satu lookup Map, dan **`new Date(ts)` — alokasi objek Date**. Selain itu
// `txCreatedAtMs()` memanggil `Date.parse()` tanpa memo sama sekali. Pada
// 20.000 baris, satu sortir penuh ≈ 300 ribu perbandingan → ~600 ribu alokasi
// Date + 600 ribu split string. Terukur: sortir = 234 ms dari 339 ms
// `renderRecentList` (v138), dan `filterTransactions` 875 ms pada 20.000 baris.
//
// Solusinya decorate–sort–undecorate: kunci numerik dihitung SEKALI per baris
// (O(n)), lalu pembanding hanya mengurangi dua angka. Urutan hasilnya IDENTIK
// dengan `[...rows].sort(txServerCompare)` — dibuktikan uji acak di
// tests/unit/tx-sort.test.js, termasuk kasus tanggal tidak sah (NaN),
// created_at hilang (-Infinity), dan tanggal+created_at kembar.
//
// Kunci disimpan di typed array (bukan objek per baris) supaya tidak menukar
// 600 ribu alokasi Date dengan 20 ribu alokasi objek.

/**
 * @param {Array<object>} rows baris transaksi (tidak diubah)
 * @param {object} deps
 * @param {(tanggal: string|null|undefined) => number} deps.tanggalMs
 *   timestamp tanggal (NaN bila tidak sah) — mis. `parseTglMs`
 * @param {(row: object) => number} deps.createdAtMs
 *   timestamp created_at (-Infinity bila tidak ada) — mis. `txCreatedAtMs`
 * @returns {Array<object>} SALINAN terurut; `rows` tidak disentuh
 */
import { selectKthInPlace } from "./tx-window.js";

export function sortTxRowsDesc(rows, { tanggalMs, createdAtMs }) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n === 0) return [];
  if (n === 1) return [rows[0]];

  const tanggal = new Float64Array(n);
  const dibuat = new Float64Array(n);
  const id = new Array(n);
  const idx = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = rows[i];
    tanggal[i] = tanggalMs(r ? r.tanggal : null);
    dibuat[i] = createdAtMs(r);
    id[i] = String((r && r.id) || "");
    idx[i] = i;
  }

  // Persis urutan txServerCompare: tanggal DESC -> created_at DESC -> id ASC.
  // Catatan NaN: bila tanggal tidak sah, selisihnya NaN dan `NaN !== 0` benar,
  // jadi NaN dikembalikan apa adanya — SAMA dengan pembanding lama.
  idx.sort((x, y) => {
    const dTanggal = tanggal[y] - tanggal[x];
    if (dTanggal !== 0) return dTanggal;
    const dDibuat = dibuat[y] - dibuat[x];
    if (dDibuat !== 0) return dDibuat;
    const ix = id[x];
    const iy = id[y];
    return ix < iy ? -1 : ix > iy ? 1 : 0;
  });

  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rows[idx[i]];
  return out;
}

/**
 * Satu "halaman" dari daftar terurut (tanggal DESC, created_at DESC, id ASC)
 * TANPA mengurutkan seluruh daftar dan TANPA membayar pembanding mahal.
 *
 * Padanan `selectSortedWindow(rows, txServerCompare, start, size)`
 * (src/domain/tx-window.js) tetapi kunci numeriknya dihitung sekali per baris.
 * Ini jalur yang dipakai `renderRecentList()`, yaitu satu-satunya tempat yang
 * benar-benar menyentuh SELURUH baris setiap render (filterTransactions hanya
 * menyortir subset hasil filter waktu -- terukur di bench-load-sync).
 *
 * @param {Array<object>} rows tidak diubah
 * @param {{tanggalMs: Function, createdAtMs: Function}} deps
 * @param {number} start indeks awal halaman
 * @param {number} size jumlah baris per halaman
 * @returns {Array<object>}
 */
export function selectWindowDesc(rows, { tanggalMs, createdAtMs }, start, size) {
  const n = Array.isArray(rows) ? rows.length : 0;
  const lo = Math.max(0, Math.trunc(Number(start)) || 0);
  const count = Math.max(0, Math.trunc(Number(size)) || 0);
  if (n === 0 || count === 0 || lo >= n) return [];

  const dec = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = rows[i];
    dec[i] = { r, t: tanggalMs(r ? r.tanggal : null), c: createdAtMs(r), id: String((r && r.id) || "") };
  }
  const cmp = (a, b) => {
    const dTanggal = b.t - a.t;
    if (dTanggal !== 0) return dTanggal;
    const dDibuat = b.c - a.c;
    if (dDibuat !== 0) return dDibuat;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const end = Math.min(lo + count, n);
  if (end === n) {
    dec.sort(cmp);
    return dec.slice(lo).map((d) => d.r);
  }
  selectKthInPlace(dec, cmp, end - 1, 0, n - 1);
  const prefix = dec.slice(0, end);
  prefix.sort(cmp);
  return prefix.slice(lo).map((d) => d.r);
}
