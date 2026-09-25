// Unit test src/domain/tx-window.js (v138): pemilihan satu halaman tanpa
// mengurutkan seluruh daftar. Inti jaminannya: hasilnya HARUS identik dengan
// `[...rows].sort(compare).slice(start, start + size)` selama `compare` adalah
// urutan total -- persis kondisi `txServerCompare` (tiebreak terakhir `id` unik).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSortedWindow, selectKthInPlace } from "../../src/domain/tx-window.js";

// Pembanding tiruan txServerCompare: tanggal menurun, lalu created_at menurun,
// lalu id menaik (urutan total karena id unik).
const compareTx = (a, b) => {
  const d = Date.parse(b.tanggal) - Date.parse(a.tanggal);
  if (d !== 0) return d;
  const c = (b.created_ms || 0) - (a.created_ms || 0);
  if (c !== 0) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const referensi = (rows, start, size) => [...rows].sort(compareTx).slice(start, start + size);

// PRNG deterministik (mulberry32) supaya kegagalan bisa direproduksi.
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

function buatBaris(n, seed) {
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const hari = Math.floor(r() * 730); // rentang 2 tahun -> banyak tanggal kembar
    const tgl = new Date(2025, 0, 1 + hari);
    rows.push({
      id: `id-${i.toString().padStart(6, "0")}-${Math.floor(r() * 1e6).toString(36)}`,
      tanggal: `${tgl.getFullYear()}-${String(tgl.getMonth() + 1).padStart(2, "0")}-${String(tgl.getDate()).padStart(2, "0")}`,
      created_ms: Math.floor(r() * 1e9),
      jumlah: Math.round(r() * 1e6),
    });
  }
  return rows;
}

test("tx-window: identik dengan sort penuh pada banyak ukuran & halaman (acak, deterministik)", () => {
  for (const seed of [1, 7, 42, 1337]) {
    for (const n of [0, 1, 2, 5, 15, 16, 17, 31, 64, 100, 257, 1000]) {
      const rows = buatBaris(n, seed);
      for (const size of [1, 10, 17]) {
        for (const start of [0, 1, 9, Math.max(0, n - size), Math.max(0, Math.floor(n / 2))]) {
          const hasil = selectSortedWindow(rows, compareTx, start, size);
          const harap = referensi(rows, start, size);
          assert.deepEqual(
            hasil.map((r) => r.id),
            harap.map((r) => r.id),
            `beda pada seed=${seed} n=${n} start=${start} size=${size}`,
          );
        }
      }
    }
  }
});

test("tx-window: benar pada data yang sudah terurut (kasus patologis pivot)", () => {
  const naik = buatBaris(200, 99).sort(compareTx);
  const turun = [...naik].reverse();
  for (const [nama, rows] of [["terurut naik", naik], ["terurut turun", turun]]) {
    for (const start of [0, 50, 190]) {
      assert.deepEqual(
        selectSortedWindow(rows, compareTx, start, 10).map((r) => r.id),
        referensi(rows, start, 10).map((r) => r.id),
        nama + " start=" + start,
      );
    }
  }
});

test("tx-window: tanggal sama semua (hanya id yang membedakan) tetap identik", () => {
  const r = rng(5);
  const rows = [];
  for (let i = 0; i < 300; i += 1) {
    rows.push({ id: `z-${i.toString().padStart(4, "0")}`, tanggal: "2026-09-25", created_ms: 0, jumlah: Math.floor(r() * 100) });
  }
  assert.deepEqual(
    selectSortedWindow(rows, compareTx, 0, 10).map((x) => x.id),
    referensi(rows, 0, 10).map((x) => x.id),
  );
  assert.deepEqual(
    selectSortedWindow(rows, compareTx, 295, 10).map((x) => x.id),
    referensi(rows, 295, 10).map((x) => x.id),
  );
});

test("tx-window: batas-batas aman (kosong, start lewat ujung, size 0/lebih, nilai aneh)", () => {
  const rows = buatBaris(25, 3);
  assert.deepEqual(selectSortedWindow([], compareTx, 0, 10), []);
  assert.deepEqual(selectSortedWindow(null, compareTx, 0, 10), []);
  assert.deepEqual(selectSortedWindow(rows, compareTx, 25, 10), [], "start == panjang");
  assert.deepEqual(selectSortedWindow(rows, compareTx, 99, 10), [], "start lewat ujung");
  assert.deepEqual(selectSortedWindow(rows, compareTx, 0, 0), [], "size 0");
  assert.deepEqual(selectSortedWindow(rows, compareTx, -5, 10).map((x) => x.id), referensi(rows, 0, 10).map((x) => x.id), "start negatif = 0");
  assert.deepEqual(selectSortedWindow(rows, compareTx, 20, 99).map((x) => x.id), referensi(rows, 20, 5).map((x) => x.id), "size melebihi sisa");
  assert.deepEqual(selectSortedWindow(rows, compareTx, 3.7, 10.2).map((x) => x.id), referensi(rows, 3, 10).map((x) => x.id), "angka pecahan dibulatkan ke bawah");
});

test("tx-window: TIDAK mengubah array masukan", () => {
  const rows = buatBaris(50, 11);
  const sebelum = rows.map((x) => x.id).join("|");
  selectSortedWindow(rows, compareTx, 0, 10);
  assert.equal(rows.map((x) => x.id).join("|"), sebelum, "urutan array asli berubah");
});

test("tx-window: hasil adalah salinan objek, bukan referensi ke array masukan", () => {
  const rows = buatBaris(30, 12);
  const hasil = selectSortedWindow(rows, compareTx, 0, 5);
  assert.equal(hasil.length, 5);
  hasil[0] = null;
  assert.ok(rows.every(Boolean), "menimpa hasil merusak array masukan");
});

test("tx-window: selectKthInPlace menaruh elemen ke-k di tempat yang benar", () => {
  for (const n of [1, 2, 17, 50, 200]) {
    const rows = buatBaris(n, n + 1);
    const urut = [...rows].sort(compareTx);
    for (const k of [0, Math.floor(n / 2), n - 1]) {
      const arr = rows.slice();
      selectKthInPlace(arr, compareTx, k, 0, arr.length - 1);
      assert.equal(arr[k].id, urut[k].id, `elemen ke-${k} salah pada n=${n}`);
      const kiriBenar = arr.slice(0, k).every((x) => compareTx(x, arr[k]) <= 0);
      const kananBenar = arr.slice(k + 1).every((x) => compareTx(x, arr[k]) >= 0);
      assert.ok(kiriBenar, `ada elemen lebih besar di kiri indeks ${k} (n=${n})`);
      assert.ok(kananBenar, `ada elemen lebih kecil di kanan indeks ${k} (n=${n})`);
    }
  }
});
