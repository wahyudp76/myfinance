/**
 * MyFinance calendar domain logic (ringkasan kas per bulan, agregasi
 * harian, & proyeksi jatuh tempo transaksi berulang ke kalender).
 *
 * Pure functions only: no DOM, Supabase, localStorage, network, atau
 * FullCalendar access. Extracted dari updateCalendarSummary(),
 * renderCalendar(), dan openCalendarDetail() di index.html (lanjutan
 * Phase 4/7 -- "Break the monolithic client into modules by domain",
 * lihat docs/architecture-modernization-plan.md). Perilaku dipertahankan
 * 100% sama seperti kode lama -- ini pemindahan, bukan penulisan ulang.
 *
 * txIdrAmount/parseTgl/advanceDueDate SENGAJA disuntik lewat parameter,
 * bukan diduplikasi -- supaya index.html tetap satu-satunya sumber
 * kebenaran untuk fungsi-fungsi itu (pola yang sama dengan modul domain
 * lain, mis. src/domain/reports.js).
 */

/**
 * Total Pemasukan & Pengeluaran (mata uang IDR-equivalent) di BULAN yang
 * sedang ditampilkan kalender -- bulan itu ditentukan dari titik tengah
 * `viewStart`/`viewEnd` (bulan aktif FullCalendar), BUKAN dari tanggal hari
 * ini, supaya benar walau ada baris minggu dari bulan sebelum/sesudahnya
 * yang ikut tampil di grid kalender. Extracted dari updateCalendarSummary().
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {Date} viewStart - awal rentang yang sedang ditampilkan (FullCalendar `view.currentStart`).
 * @param {Date} viewEnd - akhir rentang yang sedang ditampilkan (FullCalendar `view.currentEnd`).
 * @param {object} deps
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {{ totalIn: number, totalOut: number }}
 */
export function computeCalendarMonthSummary(transactions, viewStart, viewEnd, { parseTgl, txIdrAmount }) {
  const midDate = new Date((viewStart.getTime() + viewEnd.getTime()) / 2);
  const month = midDate.getMonth();
  const year = midDate.getFullYear();

  let totalIn = 0;
  let totalOut = 0;
  (transactions || []).forEach((d) => {
    const dDate = parseTgl(d.tanggal);
    if (dDate.getMonth() === month && dDate.getFullYear() === year) {
      if (d.jenis === "Pemasukan") totalIn += txIdrAmount(d);
      if (d.jenis === "Pengeluaran") totalOut += txIdrAmount(d);
    }
  });
  return { totalIn, totalOut };
}

/**
 * Agregasi Masuk/Keluar/Transfer PER TANGGAL (bukan per bulan) -- dipakai
 * baik utk daftar event kalender MAUPUN tint warna sel tanggal
 * (net positif/negatif). Extracted dari renderCalendar().
 *
 * CATATAN: kunci tanggal diambil dari `d.tanggal.split('T')[0]` (string
 * mentah), BUKAN lewat parseTgl() -- dipertahankan persis dari kode asli
 * supaya kuncinya cocok 1:1 dengan format tanggal FullCalendar
 * (`toDateStr(arg.date)`, "YYYY-MM-DD").
 *
 * @param {Array<object>} transactions
 * @param {object} deps
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {Record<string, { in: number, out: number, transfer: number }>}
 */
export function buildDailyCashflowMap(transactions, { txIdrAmount }) {
  const eventsMap = {};
  (transactions || []).forEach((d) => {
    const dateStr = d.tanggal.split("T")[0];
    const amt = txIdrAmount(d);
    if (!eventsMap[dateStr]) eventsMap[dateStr] = { in: 0, out: 0, transfer: 0 };
    if (d.jenis === "Pemasukan") eventsMap[dateStr].in += amt;
    if (d.jenis === "Pengeluaran") eventsMap[dateStr].out += amt;
    if (d.jenis === "Transfer") eventsMap[dateStr].transfer += amt;
  });
  return eventsMap;
}

/**
 * Proyeksikan tanggal jatuh tempo 1 template recurring dari
 * `item.next_due_date`, maju terus (via advanceDueDate) SELAMA <=
 * `untilDateStr`, dibatasi `item.end_date` (kalau ada) & `maxIterations`
 * (jaga-jaga spy tidak berat kalau frekuensinya harian & rentangnya jauh).
 *
 * Dipakai utk 2 kebutuhan yang sebelumnya py loop hampir identik ditulis
 * 2x: (1) renderCalendar() -- `untilDateStr` = 2 tahun ke depan, SEMUA
 * tanggal hasilnya dipakai jadi event proyeksi; (2) openCalendarDetail()
 * -- `untilDateStr` = tanggal spesifik yang diklik, lalu pemanggil cukup
 * cek `hasil.includes(untilDateStr)` utk tau apakah template ini terjadwal
 * PERSIS di tanggal itu.
 *
 * @param {{ next_due_date: string, end_date?: string|null, frequency: string }} item - 1 template recurring.
 * @param {object} deps
 * @param {string} deps.untilDateStr - batas atas tanggal (YYYY-MM-DD), inklusif.
 * @param {(dateStr: string, frequency: string) => string} deps.advanceDueDate
 * @param {number} [deps.maxIterations] - default 60, dipertahankan dari kode asli.
 * @returns {string[]} tanggal jatuh tempo (YYYY-MM-DD), terurut naik.
 */
export function projectRecurringDueDates(item, { untilDateStr, advanceDueDate, maxIterations = 60 }) {
  const dueDates = [];
  let dueDate = item.next_due_date;
  let iterations = 0;
  while (dueDate && dueDate <= untilDateStr && iterations < maxIterations) {
    if (item.end_date && dueDate > item.end_date) break;
    dueDates.push(dueDate);
    dueDate = advanceDueDate(dueDate, item.frequency);
    iterations++;
  }
  return dueDates;
}
