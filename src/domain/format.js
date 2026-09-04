/**
 * src/domain/format.js — Format & monetary helpers (pure, browser-safe).
 *
 * PILOT MIGRASI MONOLIT → MODUL.
 * Fungsi-fungsi ini sebelumnya HANYA hidup di dalam monolit `app.src.js`
 * (fungsi global di scope classic script, tanpa unit test, dan DI-INJECT
 * sebagai callback `{ formatRp, formatShortVal, txIdrAmount, ... }` ke
 * fungsi-fungsi `src/domain/**`).
 *
 * Di sini kita membuat satu "rumah" kanonik yang ter-tes unit. Perilaku
 * dipertahankan PERSIS byte-compatible terhadap implementasi monolit yang
 * berjalan di produksi saat ini (lihat tests/unit/format-domain.test.js,
 * khususnya guard `consistency vs app.src.js` yang mengekstrak implementasi
 * monolit langsung dari file sumber dan membandingkan output).
 *
 * PENTING — perilaku ini adalah KONTRAK (jangan diubah tanpa mengubah test):
 * - formatRp  : Math.round-ish via Intl id-ID, minimumFractionDigits=0.
 *               Angka desimal tetap tampil (mis. 1234.5 -> "1.234,5").
 * - txIdrAmount : hanya menormalkan jumlah_idr (IDR-equivalent), FALLBACK ke
 *               t.jumlah bila tidak ada. Untuk saldo 1 akun spesifik JANGAN
 *               pakai ini -- pakai t.jumlah (native) langsung.
 * - formatShortVal : kompak 1 desimal untuk >=1jt ("M"), bulat untuk >=1rb ("K").
 */

/** Format angka ke string Rupiah gaya id-ID (pemisah ribuan titik). */
export function formatRp(angka) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(angka);
}

/**
 * Nilai IDR-equivalent dari satu transaksi, dipakai untuk SEMUA total gabungan
 * lintas akun/kategori (Dashboard, grafik, dll). Transaksi lama (sebelum fitur
 * multi-currency) tidak punya jumlah_idr -> fallback ke jumlah apa adanya.
 */
export function txIdrAmount(t) {
  const v = t && t.jumlah_idr != null ? t.jumlah_idr : t ? t.jumlah : 0;
  return Number(v) || 0;
}

/** Format kompak: >= 1juta -> "x.yM", >= 1rb -> "xK", selainnya angka apa adanya. */
export function formatShortVal(angka) {
  if (Math.abs(angka) >= 1000000) return (angka / 1000000).toFixed(1) + "M";
  if (Math.abs(angka) >= 1000) return (angka / 1000).toFixed(0) + "K";
  return angka;
}

/**
 * Nominal sisi TUJUAN sebuah transfer. Untuk akun yang menjadi TUJUAN, nilai yang
 * diterima adalah transfer_jumlah_tujuan (dalam mata uang akun tujuan); bila kolom
 * itu tidak ada/bernilai null, jatuh ke `jumlah` (kondisi transfer mata uang sama).
 * Dipakai DC: computeAccountTotals / buildAccountBalanceSeries / computeAccountGroupNet
 * (src/domain/accounts.js) dan aggregateDashboardData (src/domain/dashboard.js).
 * KONTRAK: byte-compatible dengan implementasi monolit (tidak ada Number() coercion;
 * hasil apa adanya dari kolom DB).
 */
export function transferTargetAmount(row) {
  return row.transfer_jumlah_tujuan != null ? row.transfer_jumlah_tujuan : row.jumlah;
}

/** Deep clone obyek terserialisasi (tanpa fungsi/cycle) + toleran null/undefined. */
export function deepCloneDict(d) {
  return JSON.parse(JSON.stringify(d));
}

/**
 * Inti murni (pure) dari input ribuan: ambil digit saja dari string mentah,
 * kembalikan { digits, formatted }. Digunakan oleh handler input monolit dan
 * PENGURANG duplikasi logika `formatInputRibuan` (yang tetap DOM-bound).
 */
export function formatRibuanDigits(rawValue) {
  const digits = String(rawValue == null ? "" : rawValue).replace(/[^0-9]/g, "");
  const formatted = digits ? new Intl.NumberFormat("id-ID").format(digits) : "";
  return { digits, formatted };
}

/**
 * JSON-roundtrip yang AKAN dipakai index.html untuk meng-inject helper ini ke
 * scope monolit sebagai callback DI — persis kontrak yang sudah dipakai modul
 * `src/domain/**` (mereka menerima { formatRp, formatShortVal, txIdrAmount }).
 */
export function formatCtx() {
  return { formatRp, formatShortVal, txIdrAmount, deepCloneDict, formatRibuanDigits, transferTargetAmount };
}
