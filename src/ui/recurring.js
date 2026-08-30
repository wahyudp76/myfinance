/**
 * MyFinance UI rendering untuk fitur Transaksi Berulang -- badge ringkasan
 * di Dashboard & daftar di modal "Kelola Transaksi Berulang".
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, bangun innerHTML). Bedanya dengan sebelum
 * dipisah: semua dependency (elemen `document`, data global, helper
 * format/style, fungsi domain) SEKARANG disuntik lewat 1 objek `ctx`,
 * bukan dibaca dari closure/global langsung -- supaya (a) eksplisit apa
 * saja yang dibutuhkan fungsi ini, (b) tetap bisa ditest tanpa browser
 * sungguhan (lihat tests/unit/ui-recurring.test.js, `document` di-stub
 * pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * index.html memanggil fungsi2 ini lewat wrapper tipis bernama sama
 * (mis. `function renderRecurringSummary() { renderRecurringSummaryUI({...}) }`)
 * supaya SEMUA pemanggil lama (termasuk atribut onclick="..." di HTML)
 * tidak perlu diubah sama sekali.
 *
 * Lanjutan Phase 4/7 "split monolith" (docs/architecture-modernization-plan.md),
 * kali ini utk sisi UI/render, bukan kalkulasi murni. Perilaku dipertahankan
 * 100% sama seperti kode lama -- ini pemindahan, bukan penulisan ulang.
 */

/**
 * Update badge ringkasan Transaksi Berulang di Dashboard (elemen
 * `#recurring-summary-text`).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {Array<{active: boolean, next_due_date: string}>} ctx.globalRecurring
 * @param {() => string} ctx.todayDateStr - tanggal hari ini (YYYY-MM-DD).
 * @param {(recurring: Array<object>, todayStr: string) => {activeCount: number, overdueCount: number}} ctx.summarizeRecurringStatus -
 *   dari src/domain/recurring.js (via servicesModule).
 */
export function renderRecurringSummary({ document, globalRecurring, todayDateStr, summarizeRecurringStatus }) {
  const el = document.getElementById("recurring-summary-text");
  if (!el) return;
  const { activeCount, overdueCount } = summarizeRecurringStatus(globalRecurring, todayDateStr());
  if (activeCount === 0) { el.textContent = "Belum ada transaksi berulang"; el.className = "text-[10px] text-slate-400"; return; }
  if (overdueCount > 0) {
    el.textContent = `${overdueCount} jatuh tempo hari ini/terlewat`;
    el.className = "text-[10px] text-rose-500 font-bold";
  } else {
    el.textContent = `${activeCount} aktif`;
    el.className = "text-[10px] text-slate-400";
  }
}

/**
 * Render daftar lengkap template Transaksi Berulang di modal "Kelola"
 * (elemen `#recurring-list-container`) -- aktif duluan, lalu diurutkan
 * tanggal jatuh tempo terdekat, masing-masing dgn badge seberapa dekat
 * jatuh temponya.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {Array<object>} ctx.globalRecurring
 * @param {() => string} ctx.todayDateStr
 * @param {(kategori: string, jenis: string) => {icon: string, bg: string, color: string, image?: string}} ctx.getCategoryStyle
 * @param {(style: object, wrapClass?: string, iconSizeClass?: string) => string} ctx.categoryIconHtml
 * @param {(nextDueDate: string, active: boolean, todayStr: string) => {daysLeft: number, level: string|null}} ctx.classifyRecurringDueBadge -
 *   dari src/domain/recurring.js (via servicesModule).
 * @param {(str: string) => string} ctx.escapeHtml
 * @param {(str: string) => string} ctx.jsStr - escape utk dipakai di dalam atribut onclick="...".
 * @param {(angka: number) => string} ctx.formatRp
 * @param {Record<string, string>} ctx.RECURRING_FREQ_LABEL
 */
export function renderRecurringListModal({
  document, globalRecurring, todayDateStr, getCategoryStyle, categoryIconHtml,
  classifyRecurringDueBadge, escapeHtml, jsStr, formatRp, RECURRING_FREQ_LABEL,
}) {
  const container = document.getElementById("recurring-list-container");
  if (!container) return;
  if (!globalRecurring || globalRecurring.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fas fa-repeat text-3xl mb-3"></i><p class="text-xs font-semibold">Belum ada transaksi berulang.</p><p class="text-[11px] mt-1">Contoh: gaji bulanan, tagihan listrik, langganan streaming, cicilan.</p></div>`;
    return;
  }
  const sorted = [...globalRecurring].sort((a, b) => (b.active - a.active) || a.next_due_date.localeCompare(b.next_due_date));
  const todayStr0 = todayDateStr();
  container.innerHTML = sorted.map((item) => {
    const style = getCategoryStyle(item.kategori, item.jenis);
    const dueLabel = new Date(item.next_due_date + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    const sign = item.jenis === "Pengeluaran" ? "-" : (item.jenis === "Pemasukan" ? "+" : "");
    // Tambahan: penanda visual seberapa dekat jatuh tempo -- sebelumnya tanggal "Berikutnya"
    // cuma teks abu-abu polos, jadi user harus baca satu-satu buat tau mana yang perlu
    // disiapkan dananya duluan. Transaksinya sendiri tetap otomatis tercatat begitu jatuh
    // tempo lewat processDueRecurring() -- ini murni bantu user lihat sekilas, bukan pengganti itu.
    const { daysLeft, level: dueLevel } = classifyRecurringDueBadge(item.next_due_date, item.active, todayStr0);
    let dueBadge = "";
    if (dueLevel === "overdue") dueBadge = `<span class="text-rose-500 font-bold">&middot; Terlewat ${Math.abs(daysLeft)} hari</span>`;
    else if (dueLevel === "today") dueBadge = `<span class="text-rose-500 font-bold">&middot; Jatuh tempo hari ini</span>`;
    else if (dueLevel === "soon") dueBadge = `<span class="text-amber-500 font-bold">&middot; ${daysLeft} hari lagi</span>`;
    return `
    <div class="flex items-center bg-white border border-slate-100 rounded-2xl p-3 mb-2 ${item.active ? "" : "opacity-50"}">
        ${categoryIconHtml(style, "w-10 h-10 rounded-xl flex items-center justify-center mr-3 flex-shrink-0")}
        <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(item.keterangan || item.kategori)}</p>
            <p class="text-[10px] text-slate-400">${RECURRING_FREQ_LABEL[item.frequency] || item.frequency} &middot; Berikutnya: ${dueLabel} ${dueBadge}</p>
        </div>
        <div class="text-right mr-2 flex-shrink-0">
            <p class="text-xs font-extrabold ${item.jenis === "Pengeluaran" ? "text-rose-500" : (item.jenis === "Pemasukan" ? "text-emerald-500" : "text-blue-500")}">${sign} Rp ${formatRp(item.jumlah)}</p>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
            <button onclick="toggleRecurringActive('${jsStr(item.id)}', ${item.active})" aria-label="${item.active ? "Jeda" : "Aktifkan"}" class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center"><i class="fas ${item.active ? "fa-pause" : "fa-play"} text-[11px]"></i></button>
            <button onclick="openRecurringFormModal('${jsStr(item.id)}')" aria-label="Edit" class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center"><i class="fas fa-pencil text-[11px]"></i></button>
            <button onclick="deleteRecurringTemplate('${jsStr(item.id)}')" aria-label="Hapus" class="w-7 h-7 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 flex items-center justify-center"><i class="fas fa-trash-alt text-[11px]"></i></button>
        </div>
    </div>`;
  }).join("");
}
