/**
 * src/domain/dates.js — Date/monetary-adjacent pure helpers (browser-safe).
 *
 * PILOT MIGRASI MONOLIT → MODUL (lanjutan setelah src/domain/format.js).
 * parseTgl / toDateStr / todayDateStr sebelumnya HANYA hidup di monolit
 * app.src.js (global, tanpa unit test), padahal DI-INJECT sebagai callback DI
 * { parseTgl, toDateStr } ke banyak fungsi ter-tes di src/domain/** :
 *   - computeLast30DaysView / computeCustomMonthView / computeDateRangeView
 *     (src/domain/transactions.js)
 *   - computeYearlySummary / computeMonthlyBreakdown (src/domain/reports.js)
 *   - computeCalendarMonthSummary / buildDailyCashflowMap (src/domain/calendar.js)
 *   - aggregateActualByCategory (src/domain/budgets.js)
 *   - computeCategoryDetailMonthChart / aggregateSubCategoryShares (src/domain/categories.js)
 *   - buildAccountBalanceSeries / aggregateAccountExpenseByCategory (src/domain/accounts.js)
 *
 * Di sini dibuat satu rumah kanonik ter-tes. Perilaku dipertahankan
 * byte-compatible dengan implementasi monolit yang berjalan di produksi
 * (lihat tests/unit/dates-domain.test.js: guard konsistensi mengekstrak
 * implementasi DEFAULT __dates dari app.src.js & menyamakan output).
 *
 * KONTRAK (jangan diubah tanpa mengubah test):
 * - parseTgl : tanggal lokal YYYY-MM-DD -> Date lokal tengah malam. Null/empty -> new Date(NaN).
 * - toDateStr : Date -> "YYYY-MM-DD" pakai komponen LOKAL (BUKAN toISOString/UTC),
 *               sebab toISOString mundur satu hari untuk zona lebih cepat dari UTC.
 * - todayDateStr : "hari ini" dalam bentuk YYYY-MM-DD aman zona waktu.
 */

// v112 (perf): memo string-tanggal -> timestamp. parseTgl dipanggil PULUHAN RIBU
// kali per render pada dataset besar (comparator sort txServerCompare memanggil
// parseTgl 2x per perbandingan, plus tiap pass agregasi dashboard/insights/
// laporan), dan `new Date("<string>")` harus lewat DateParser yang jauh lebih
// mahal daripada `new Date(<number>)`. Memo menyimpan TIMESTAMP (bukan objek
// Date) dan tetap mengembalikan objek Date BARU per panggilan -- mutasi hasil
// oleh pemanggil (mis. cursor.setMonth di src/domain/transactions.js) tidak
// pernah menular antar-panggilan. Perilaku output identik dengan implementasi
// lama (dijaga guard konsistensi tests/unit/dates-domain.test.js).
const _tglMemo = new Map();
const _TGL_MEMO_MAX = 1024;

/** Ubah string "YYYY-MM-DD" (atau ISO dengan T) -> Date lokal tengah malam. Null/empty -> invalid. */
export function parseTgl(tanggalStr) {
  if (!tanggalStr) return new Date(NaN);
  const key = String(tanggalStr).split("T")[0];
  let ts = _tglMemo.get(key);
  if (ts === undefined) {
    ts = new Date(key + "T00:00:00").getTime();
    if (_tglMemo.size >= _TGL_MEMO_MAX) _tglMemo.clear(); // jaga ukuran tetap kecil; dataset realistis ~ribuan tanggal unik
    _tglMemo.set(key, ts);
  }
  return new Date(ts);
}

/** Ubah Date -> "YYYY-MM-DD" pakai komponen lokal (aman zona waktu; BUKAN toISOString/UTC). */
export function toDateStr(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** "Hari ini" sebagai "YYYY-MM-DD" aman zona waktu. */
export function todayDateStr() {
  return toDateStr(new Date());
}

/** Bulan berjalan sebagai "YYYY-MM" (filter/penyiapan cache budget & laporan). */
export function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

/** Objek DI (default-injection) yang dipakai monolit untuk meng-inject ke modul ter-tes. */
export function dateCtx() {
  return { parseTgl, toDateStr, todayDateStr, currentMonthStr };
}
