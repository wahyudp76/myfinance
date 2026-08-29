/**
 * Pure recurring-transaction domain logic.
 * No DOM, Supabase, localStorage or network access -- safe to unit test directly.
 */

function toDateStr(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * Menghitung tanggal jatuh tempo BERIKUTNYA dari satu tanggal, sesuai frekuensinya.
 * PENTING: setMonth()/setFullYear() bawaan JS diam-diam "meluber" ke bulan berikutnya kalau
 * tanggal asalnya (29/30/31) tidak ada di bulan/tahun target (mis. 31 Jan + 1 bulan jadi malah
 * 3 Maret, bukan 28 Feb) -- ini bikin jadwal transaksi berulang bergeser tiap kali melewati
 * bulan yang lebih pendek. Jadi dicek & dijatuhkan ke hari TERAKHIR bulan/tahun target kalau meluber.
 */
export function advanceDueDate(dateStr, frequency) {
  const d = new Date(dateStr + "T00:00:00");
  if (frequency === "harian") { d.setDate(d.getDate() + 1); return toDateStr(d); }
  if (frequency === "mingguan") { d.setDate(d.getDate() + 7); return toDateStr(d); }
  if (frequency === "bulanan") {
    const targetMonth = d.getMonth() + 1;
    d.setMonth(targetMonth);
    if (d.getMonth() !== (targetMonth % 12)) { d.setDate(0); }
    return toDateStr(d);
  }
  if (frequency === "tahunan") {
    const originalMonth = d.getMonth();
    d.setFullYear(d.getFullYear() + 1);
    if (d.getMonth() !== originalMonth) { d.setDate(0); }
    return toDateStr(d);
  }
  return toDateStr(d);
}

/**
 * Menghitung RENCANA catch-up untuk SATU template recurring, TANPA melakukan efek samping
 * apa pun (tidak memanggil RPC/API) -- pemanggilnya (index.html) yang bertanggung jawab
 * mengeksekusi setiap tanggal di `dueDates` lewat createRecurringTransaction(), lalu HANYA
 * menerapkan `nextDueDateAfter`/`shouldDeactivate` kalau SEMUA tanggal itu berhasil dicatat.
 * Kalau salah satu gagal di tengah jalan, pemanggil harus membiarkan next_due_date di
 * database TETAP seperti semula supaya periode yang belum berhasil dicoba lagi sesi berikutnya.
 *
 * @param {object} params
 * @param {string} params.nextDueDate - next_due_date saat ini (YYYY-MM-DD)
 * @param {string|null|undefined} params.endDate - end_date template (YYYY-MM-DD) atau null/undefined
 * @param {string} params.frequency - 'harian' | 'mingguan' | 'bulanan' | 'tahunan'
 * @param {string} params.todayStr - tanggal hari ini (YYYY-MM-DD)
 * @param {number} [params.maxCatchup] - batas aman jumlah periode yang dikejar sekaligus
 * @returns {{ dueDates: string[], nextDueDateAfter: string, shouldDeactivate: boolean }}
 */
export function planRecurringCatchup({ nextDueDate, endDate, frequency, todayStr, maxCatchup = 36 }) {
  const dueDates = [];
  let dueDate = nextDueDate;
  let count = 0;

  while (dueDate <= todayStr && count < maxCatchup) {
    if (endDate && dueDate > endDate) break;
    dueDates.push(dueDate);
    count++;
    dueDate = advanceDueDate(dueDate, frequency);
  }

  return {
    dueDates,
    nextDueDateAfter: dueDate,
    shouldDeactivate: Boolean(endDate && dueDate > endDate),
  };
}

/**
 * Ringkasan status transaksi berulang utk badge kecil di Dashboard
 * ("recurring-summary-text") -- jumlah yang aktif & berapa di antaranya
 * yang sudah jatuh tempo hari ini/terlewat. Extracted dari
 * renderRecurringSummary() di index.html. Pemetaan ke teks/warna tampilan
 * TETAP di index.html (presentation layer).
 *
 * @param {Array<{active: boolean, next_due_date: string}>} recurring - semua template (globalRecurring).
 * @param {string} todayStr - tanggal hari ini (YYYY-MM-DD).
 * @returns {{ activeCount: number, overdueCount: number }}
 */
export function summarizeRecurringStatus(recurring, todayStr) {
  const active = (recurring || []).filter((r) => r.active);
  const overdueCount = active.filter((r) => r.next_due_date <= todayStr).length;
  return { activeCount: active.length, overdueCount };
}

/**
 * Klasifikasi seberapa dekat 1 template recurring ke jatuh temponya, utk
 * badge visual di modal "Kelola Transaksi Berulang" -- HANYA dihitung utk
 * template yang masih aktif (yang dijeda tidak relevan diburu-buru), sesuai
 * kode asli. Extracted dari renderRecurringListModal() di index.html.
 *
 * @param {string} nextDueDate - next_due_date template (YYYY-MM-DD).
 * @param {boolean} active
 * @param {string} todayStr - tanggal hari ini (YYYY-MM-DD).
 * @returns {{ daysLeft: number, level: 'overdue'|'today'|'soon'|null }} -
 *   `level` null kalau template tidak aktif ATAU jatuh temponya masih >3 hari lagi.
 */
export function classifyRecurringDueBadge(nextDueDate, active, todayStr) {
  const daysLeft = Math.round((new Date(nextDueDate + "T00:00:00") - new Date(todayStr + "T00:00:00")) / 86400000);
  let level = null;
  if (active) {
    if (daysLeft < 0) level = "overdue";
    else if (daysLeft === 0) level = "today";
    else if (daysLeft <= 3) level = "soon";
  }
  return { daysLeft, level };
}
