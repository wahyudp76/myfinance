// src/domain/tx-window.js — pilih SATU HALAMAN dari daftar yang seharusnya
// terurut, TANPA mengurutkan seluruh daftar.
//
// KENAPA ADA (audit menyeluruh 2026-09-17 + pengukuran 2026-09-25):
// `renderRecentList()` di app.src.js melakukan `[...data].sort(txServerCompare)`
// penuh lalu `.slice(pageStart, pageStart + 10)` — artinya untuk menampilkan
// 10 baris, SELURUH transaksi diurutkan. Terukur di Chromium sungguhan
// (scripts/bench-load-sync.mjs, CPU 4x throttle, median):
//
//     renderRecentList :  31,1 ms (2.500 baris)   338,9 ms (20.000 baris)
//     SORT penuh       :  18,1 ms (2.500 baris)   234,0 ms (20.000 baris)
//
// yaitu sortir = 69% biaya render daftar terakhir pada 20.000 baris, dan fungsi
// ini dipanggil di jalur panas (setiap simpan transaksi + setiap pindah tab).
// Mengganti sortir penuh dengan quickselect tiga-arah (O(n)) + sortir hanya
// pada prefiks yang benar-benar dipakai memotong bagian itu.
//
// SYARAT PENTING: `compare` HARUS merupakan urutan total — tidak boleh ada dua
// baris yang dianggap "sama" (mengembalikan 0). `txServerCompare` memenuhinya:
// pembanding terakhirnya `id` (unik dari Postgres). Dengan urutan total, jendela
// yang dipilih dijamin IDENTIK dengan hasil `[...rows].sort(compare).slice(...)`
// — dibuktikan oleh uji acak di tests/unit/tx-window.test.js. (Partisi tetap
// ditulis tiga-arah supaya aman bila suatu saat ada elemen setara: hasilnya
// tetap jendela yang sah, hanya urutan antar elemen setara yang tak dijamin.)

/** Tukar dua elemen di tempat. */
function swap(arr, i, j) {
  const t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}

/** Insertion sort pada rentang [left, right] — dipakai untuk rentang kecil. */
function insertionSortRange(arr, compare, left, right) {
  for (let i = left + 1; i <= right; i += 1) {
    const v = arr[i];
    let j = i - 1;
    while (j >= left && compare(arr[j], v) > 0) {
      arr[j + 1] = arr[j];
      j -= 1;
    }
    arr[j + 1] = v;
  }
}

/**
 * Susun arr[left], arr[mid], arr[right] agar terurut, kembalikan yang tengah.
 * Median-of-three membuat data yang SUDAH hampir terurut (kondisi nyata:
 * transaksi datang dari server terurut tanggal menurun) tidak menjadi kasus
 * terburuk quickselect.
 */
function medianOfThree(arr, compare, left, right) {
  const mid = (left + right) >> 1;
  if (compare(arr[mid], arr[left]) < 0) swap(arr, left, mid);
  if (compare(arr[right], arr[left]) < 0) swap(arr, left, right);
  if (compare(arr[right], arr[mid]) < 0) swap(arr, mid, right);
  return arr[mid];
}

/**
 * Pastikan arr[k] berada di posisi yang benar bila arr diurutkan penuh:
 * semua elemen di indeks < k lebih kecil (atau setara), semua di indeks > k
 * lebih besar. Elemen lain TIDAK diurutkan — itu inti penghematannya.
 *
 * Iteratif (tanpa rekursi) dengan partisi tiga arah, jadi tidak ada risiko
 * stack overflow pada ratusan ribu baris.
 *
 * @param {Array} arr diubah DI TEMPAT
 * @param {(a: any, b: any) => number} compare
 * @param {number} k indeks target (0-based)
 * @param {number} [left]
 * @param {number} [right]
 * @returns {void}
 */
export function selectKthInPlace(arr, compare, k, left = 0, right = arr.length - 1) {
  let lo = left;
  let hi = right;
  while (hi > lo) {
    if (hi - lo < 16) {
      insertionSortRange(arr, compare, lo, hi);
      return;
    }
    const pivot = medianOfThree(arr, compare, lo, hi);
    let lt = lo;
    let gt = hi;
    let i = lo;
    while (i <= gt) {
      const c = compare(arr[i], pivot);
      if (c < 0) {
        swap(arr, lt, i);
        lt += 1;
        i += 1;
      } else if (c > 0) {
        swap(arr, i, gt);
        gt -= 1;
      } else {
        i += 1;
      }
    }
    if (k < lt) hi = lt - 1;
    else if (k > gt) lo = gt + 1;
    else return; // k jatuh di blok elemen setara pivot -> sudah benar
  }
}

/**
 * Ambil satu "halaman" dari daftar seolah-olah daftar itu diurutkan penuh.
 *
 * Setara dengan `[...rows].sort(compare).slice(start, start + size)` selama
 * `compare` adalah urutan total, tetapi hanya mengurutkan sebanyak yang
 * ditampilkan (plus satu lintasan quickselect O(n)).
 *
 * Tidak mengubah `rows` (disalin dulu) — persis seperti `[...data].sort(...)`.
 *
 * @param {Array} rows
 * @param {(a: any, b: any) => number} compare urutan total
 * @param {number} start indeks awal halaman (0-based)
 * @param {number} size jumlah baris per halaman
 * @returns {Array} salinan baris pada halaman itu, terurut
 */
export function selectSortedWindow(rows, compare, start, size) {
  const n = Array.isArray(rows) ? rows.length : 0;
  const lo = Math.max(0, Math.trunc(Number(start)) || 0);
  const count = Math.max(0, Math.trunc(Number(size)) || 0);
  if (n === 0 || count === 0 || lo >= n) return [];
  const arr = rows.slice();
  const end = Math.min(lo + count, n); // eksklusif
  if (end === n) {
    // Halaman terakhir sampai ujung: prefiksnya seluruh array, jadi sortir
    // penuh memang paling murah (quickselect tidak menghemat apa pun).
    arr.sort(compare);
    return arr.slice(lo, n);
  }
  selectKthInPlace(arr, compare, end - 1, 0, n - 1);
  const prefix = arr.slice(0, end);
  prefix.sort(compare);
  return prefix.slice(lo);
}
