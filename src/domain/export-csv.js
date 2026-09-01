/**
 * Pure CSV export builders. No DOM, no network, no file I/O.
 *
 * Dipakai fitur "Ekspor Transaksi (CSV)" di tab Pengaturan -- user bisa membuka
 * hasilnya di Excel/Google Sheets. Format sengaja konservatif:
 *  - BOM UTF-8 di depan supaya Excel tidak merusak karakter beraksen,
 *  - pemisah koma dengan quoting RFC-4180,
 *  - baris diakhiri CRLF (standar CSV, aman lintas platform),
 *  - nominal ditulis sebagai angka mentah (tanpa titik ribuan) agar langsung
 *    bisa di-SUM di spreadsheet.
 */

export const CSV_TRANSACTIONS_HEADER = ["Tanggal", "Jenis", "Kategori", "Akun", "Nominal", "Keterangan", "Mata Uang"];

/** Quote satu sel sesuai RFC-4180: hanya bila mengandung koma/petik/baris baru. */
export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Bangun isi file CSV transaksi. `rows` = baris transaksi apa adanya (field
 * tanggal/jenis/kategori/akun/jumlah/keterangan/mata_uang -- bentuk tabel Supabase).
 * Opsional `txIdrAmount(row)` untuk menormalkan nominal (string/koma dsb); default
 * Number(row.jumlah) || 0. Urutan baris = apa adanya dari pemanggil.
 */
export function buildTransactionsCsv(rows, { txIdrAmount } = {}) {
  const lines = [CSV_TRANSACTIONS_HEADER.join(",")];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const r = row || {};
    const amount = typeof txIdrAmount === "function" ? txIdrAmount(r) : (Number(r.jumlah) || 0);
    lines.push(
      [
        r.tanggal || "",
        r.jenis || "",
        r.kategori || "",
        r.akun || "",
        String(amount),
        r.keterangan || "",
        r.mata_uang || "IDR",
      ].map(csvEscape).join(",")
    );
  });
  return "\uFEFF" + lines.join("\r\n");
}

/** Nama file unduhan: `<prefix>-<YYYY-MM-DD>.csv` (dateStr boleh ISO penuh). */
export function csvFileName(prefix, dateStr) {
  const d = String(dateStr || "").slice(0, 10) || "export";
  return `${prefix}-${d}.csv`;
}

/**
 * Filter baris transaksi utk ekspor per rentang. `range`:
 *  - 'month'  : bulan kalender berjalan (berdasarkan `today`),
 *  - '3month' : 92 hari ke belakang (inklusif hari ini),
 *  - 'all'    : semua baris.
 * `today` = string YYYY-MM-DD (disuntik agar murni/teruji). Hasil diurutkan
 * menaik berdasarkan tanggal lalu created_at/id agar stabil.
 */
export function filterTransactionsForRange(rows, range, today) {
  const all = Array.isArray(rows) ? rows.slice() : [];
  const t = String(today || "");
  let out = all;
  if (range === "month" && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const ym = t.slice(0, 7);
    out = all.filter((r) => String((r && r.tanggal) || "").slice(0, 7) === ym);
  } else if (range === "3month" && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const end = new Date(t + "T00:00:00Z");
    const start = new Date(end.getTime() - 91 * 86400000); // 92 hari inklusif
    const startStr = start.toISOString().slice(0, 10);
    out = all.filter((r) => {
      const d = String((r && r.tanggal) || "");
      return d >= startStr && d <= t;
    });
  }
  out.sort((a, b) => {
    const da = String((a && a.tanggal) || "");
    const db = String((b && b.tanggal) || "");
    if (da !== db) return da < db ? -1 : 1;
    const ca = String((a && (a.created_at || a.id)) || "");
    const cb = String((b && (b.created_at || b.id)) || "");
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
  return out;
}
