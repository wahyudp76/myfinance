/**
 * MyFinance UI rendering utk tab Kalender: ringkasan masuk/keluar bulan
 * yg ditampilkan (updateCalendarSummary), kalender FullCalendar lengkap
 * dgn event arus kas harian + proyeksi tagihan berulang (renderCalendar),
 * & modal detail transaksi per tanggal termasuk item terjadwal masa depan
 * (openCalendarDetail).
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, buat instance FullCalendar). Bedanya dengan
 * sebelum dipindah: semua dependency (elemen `document`, `window`, data
 * global, helper format/parse, fungsi domain, loader library, state
 * instance kalender) SEKARANG disuntik lewat 1 objek `ctx`, bukan dibaca
 * dari closure/global langsung -- supaya (a) eksplisit apa saja yang
 * dibutuhkan fungsi ini, (b) tetap bisa dites tanpa browser sungguhan
 * (lihat tests/unit/ui-calendar.test.js: `document`, `window`, &
 * FullCalendar di-stub pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * CATATAN window.FullCalendar: kode lama menulis `new FullCalendar...`
 * (global browser). Modul ini SENGAJA menulis `window.FullCalendar` --
 * global yang sama, tapi aman dirujuk kapan pun (referensi polos
 * `FullCalendar` di wrapper bisa melempar ReferenceError kalau dievaluasi
 * sebelum lazy-load selesai). `window` juga dipakai utk cek breakpoint
 * mobile (innerWidth), persis kode lama.
 *
 * Yang SENGAJA TIDAK ikut pindah (tetap di index.html):
 * - loadFullCalendarLib + cache promise-nya (infrastruktur lazy-load
 *   script CDN) -- di-inject sebagai ctx dep.
 * - State calendarInstance & _calendarWasMobile -- dibaca JUGA oleh
 *   handler resize (handleResponsiveRerender: updateSize vs render ulang)
 *   & teardown logout, jadi kepemilikannya tetap di index.html. Modul
 *   menerima instance SAAT INI lewat ctx.calendarInstance (utk
 *   preservedDate + destroy) dan melaporkan instance baru lewat callback
 *   ctx.onInstanceReady(instance, isMobile) -- dipanggil di titik PERSIS
 *   di mana kode lama meng-assign calendarInstance/_calendarWasMobile
 *   (setelah konstruksi, sebelum .render()).
 * - closeCalendarDetail (action tutup modal, dirujuk onclick di markup).
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola ketujuh setelah
 * src/ui/recurring.js (13d8a37), insights.js (af8b4a2), goals-debts.js
 * (089aa40), assets.js (7e021b6), budgets.js (b1ea0a8) &
 * categories.js (3de2ad7). Pasangan domain-nya: src/domain/calendar.js
 * (computeCalendarMonthSummary, buildDailyCashflowMap &
 * projectRecurringDueDates, commit 5950e47) + src/domain/recurring.js
 * (advanceDueDate).
 */

/**
 * Update ringkasan masuk/keluar bulan yg sedang ditampilkan di kalender
 * (elemen `#cal-in` & `#cal-out`) -- dipanggil dari callback datesSet
 * FullCalendar tiap kali user pindah bulan.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {Array<object>} ctx.globalData - semua transaksi.
 * @param {(data: Array<object>, viewStart: Date, viewEnd: Date, opts: object) => {totalIn: number, totalOut: number}} ctx.computeCalendarMonthSummary -
 *   dari src/domain/calendar.js (via servicesModule).
 * @param {(tanggalStr: string) => Date} ctx.parseTgl
 * @param {(t: object) => number} ctx.txIdrAmount
 * @param {(el: object, targetValue: number, maskable?: boolean) => void} ctx.animateRupiah
 * @param {Date} viewStart - awal rentang tampilan kalender aktif.
 * @param {Date} viewEnd - akhir rentang tampilan kalender aktif.
 */
export function updateCalendarSummary({ document, globalData, computeCalendarMonthSummary, parseTgl, txIdrAmount, animateRupiah }, viewStart, viewEnd) {
  // Satu sumber kebenaran sekarang src/domain/calendar.js (dipakai juga oleh
  // tests/unit/calendar-domain.test.js).
  const { totalIn, totalOut } = computeCalendarMonthSummary(globalData, viewStart, viewEnd, { parseTgl, txIdrAmount });
  let elIn = document.getElementById("cal-in"); let elOut = document.getElementById("cal-out");
  if (elIn) animateRupiah(elIn, totalIn); if (elOut) animateRupiah(elOut, totalOut);
}

/**
 * Render ulang kalender FullCalendar (elemen `#calendar`): event arus kas
 * harian (masuk hijau / keluar merah / transfer biru), proyeksi tagihan
 * berulang sampai 2 tahun ke depan (garis putus-putus + ikon repeat),
 * tint sel tanggal berdasarkan arus kas bersih, toolbar mobile/desktop,
 * & pemeliharaan bulan aktif antar-render (preservedDate).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{FullCalendar?: object, innerWidth: number}} ctx.window - global browser; FullCalendar tersedia SETELAH loadFullCalendarLib resolve.
 * @param {Array<object>} ctx.data - transaksi utk event kalender (biasanya globalData).
 * @param {() => Promise<void>} ctx.loadFullCalendarLib - lazy-loader CDN FullCalendar di index.html.
 * @param {(msg: string) => void} ctx.showErrorToast
 * @param {(data: Array<object>, opts: {txIdrAmount: Function}) => Record<string, {in: number, out: number, transfer: number}>} ctx.buildDailyCashflowMap -
 *   dari src/domain/calendar.js (via servicesModule).
 * @param {(t: object) => number} ctx.txIdrAmount
 * @param {(angka: number) => string} ctx.formatShortVal
 * @param {Array<object>} ctx.globalRecurring - template transaksi berulang (hanya yg active diproyeksikan).
 * @param {(item: object, opts: {untilDateStr: string, advanceDueDate: Function}) => string[]} ctx.projectRecurringDueDates -
 *   dari src/domain/calendar.js (via servicesModule).
 * @param {(item: object) => string} ctx.advanceDueDate - dari src/domain/recurring.js (via servicesModule).
 * @param {(d: Date) => string} ctx.toDateStr
 * @param {() => string} ctx.todayDateStr
 * @param {object|null} ctx.calendarInstance - instance kalender SAAT INI (milik index.html) utk preservedDate + destroy.
 * @param {(instance: object, isMobile: boolean) => void} ctx.onInstanceReady - dipanggil di titik yang sama dgn assignment state kode lama (setelah konstruksi, sebelum .render()).
 * @param {(viewStart: Date, viewEnd: Date) => void} ctx.updateCalendarSummary - wrapper global di index.html (dipanggil callback datesSet).
 * @param {(dateStr: string) => void} ctx.openCalendarDetail - wrapper global di index.html (dipanggil callback dateClick/eventClick).
 */
export async function renderCalendar({
  document, window, data, loadFullCalendarLib, showErrorToast,
  buildDailyCashflowMap, txIdrAmount, formatShortVal,
  globalRecurring, projectRecurringDueDates, advanceDueDate,
  toDateStr, todayDateStr, calendarInstance, onInstanceReady,
  updateCalendarSummary, openCalendarDetail,
}) {
  try {
    await loadFullCalendarLib();
  } catch (e) {
    console.error(e);
    showErrorToast("Gagal memuat komponen kalender. Cek koneksi internet lalu coba lagi.");
    return;
  }
  // Agregasi harian & proyeksi jatuh tempo recurring: satu sumber kebenaran sekarang
  // src/domain/calendar.js (dipakai juga oleh tests/unit/calendar-domain.test.js).
  let eventsMap = buildDailyCashflowMap(data, { txIdrAmount });
  let calendarEvents = [];
  Object.keys(eventsMap).forEach(date => {
    if (eventsMap[date].in > 0) calendarEvents.push({ title: "+" + formatShortVal(eventsMap[date].in), start: date, backgroundColor: "#d1fae5", textColor: "#059669" });
    if (eventsMap[date].out > 0) calendarEvents.push({ title: "-" + formatShortVal(eventsMap[date].out), start: date, backgroundColor: "#ffe4e6", textColor: "#e11d48" });
    if (eventsMap[date].transfer > 0) calendarEvents.push({ title: "⇄" + formatShortVal(eventsMap[date].transfer), start: date, backgroundColor: "#dbeafe", textColor: "#2563eb" });
  });

  // TAMBAHAN 1: proyeksi TAGIHAN BERULANG yang akan datang (belum benar-benar tercatat --
  // beda dari event di atas yg semuanya transaksi yg SUDAH terjadi). Ini yang bikin kalender
  // berguna buat PERENCANAAN ke depan ("apa saja yang bakal jatuh tempo bulan ini"), bukan
  // cuma catatan yg sudah lewat. Ditandai gaya berbeda (garis putus-putus, ikon repeat) di
  // renderEventContent supaya tidak tertukar dgn transaksi yg sudah benar-benar tercatat.
  // Diproyeksikan sampai 2 tahun ke depan (dibatasi juga oleh end_date template kalau ada),
  // dgn batas iterasi jaga-jaga spy tidak berat kalau frekuensinya harian.
  const projectionCeiling = new Date(); projectionCeiling.setFullYear(projectionCeiling.getFullYear() + 2);
  const projectionCeilingStr = toDateStr(projectionCeiling);
  (globalRecurring || []).filter(r => r.active).forEach(item => {
    const dueDates = projectRecurringDueDates(item, { untilDateStr: projectionCeilingStr, advanceDueDate });
    dueDates.forEach(dueDate => {
      calendarEvents.push({
        title: (item.jenis === "Pengeluaran" ? "-" : (item.jenis === "Pemasukan" ? "+" : "⇄")) + formatShortVal(item.jumlah),
        start: dueDate,
        classNames: ["cal-event-projected"],
        extendedProps: { isProjected: true, recurringLabel: item.keterangan || item.kategori, frequency: item.frequency }
      });
    });
  });

  let isMobile = window.innerWidth < 768;
  // Simpan tanggal yang lagi ditampilkan SEBELUM instance lama dihancurkan, supaya
  // kalender tidak "melompat" balik ke bulan ini setiap kali renderCalendar() terpanggil
  // ulang (mis. dari resize/orientationchange) padahal user sudah pindah ke bulan lain.
  // Ini penyebab utama tombol next/prev bulan terasa "ngebug" -- pindah bulan berbeda
  // jumlah baris minggu (5 vs 6 baris) mengubah tinggi halaman cukup untuk memicu
  // scrollbar muncul/hilang, yang di banyak browser ikut memicu event 'resize' window.
  const preservedDate = calendarInstance ? calendarInstance.getDate() : null;
  if (calendarInstance) calendarInstance.destroy();
  const newInstance = new window.FullCalendar.Calendar(document.getElementById("calendar"), {
    initialView: "dayGridMonth", initialDate: preservedDate || undefined, events: calendarEvents, height: "auto", contentHeight: "auto", aspectRatio: isMobile ? 0.7 : 1.35, dayMaxEvents: 3,
    // TAMBAHAN 2: render custom cuma utk event proyeksi (tambah ikon repeat) -- event
    // transaksi asli tetap pakai rendering bawaan FullCalendar (return true), supaya
    // tidak menyentuh/berisiko ke jalur yg sudah jalan baik.
    eventContent: function(arg) {
      if (arg.event.extendedProps.isProjected) {
        return { html: `<div class="cal-event-projected-inner"><i class="fas fa-repeat"></i>${arg.event.title}</div>` };
      }
      return true;
    },
    // TAMBAHAN 3: tint tipis di sel tanggal berdasarkan arus kas bersih hari itu (hijau =
    // net positif, merah = net negatif) -- sekilas kelihatan pola bulan ini tanpa perlu
    // baca angka satu-satu. Cuma utk tanggal yg BENAR-BENAR punya transaksi (bukan yg cuma
    // ada proyeksi tagihan), dan diabaikan di tanggal "hari ini" spy tidak tabrakan dgn
    // highlight gradient ungu yg sudah ada.
    dayCellClassNames: function(arg) {
      const ds = toDateStr(arg.date);
      const ev = eventsMap[ds];
      if (!ev || ds === todayDateStr()) return [];
      const net = ev.in - ev.out;
      if (net > 0) return ["cal-day-positive"];
      if (net < 0) return ["cal-day-negative"];
      return [];
    },
    headerToolbar: { left: isMobile ? "title" : "prev,next", center: isMobile ? "" : "title", right: isMobile ? "prev,next" : "today" }, buttonText: { today: "Hari Ini" },
    datesSet: function(info) { updateCalendarSummary(info.view.currentStart, info.view.currentEnd); },
    dateClick: function(info) { openCalendarDetail(info.dateStr); }, eventClick: function(info) { openCalendarDetail(info.event.startStr.split("T")[0]); }
  });
  // Titik yang sama dgn kode lama ketika calendarInstance/_calendarWasMobile
  // di-assign (setelah konstruksi, sebelum .render()) -- sekarang lewat callback
  // supaya kepemilikan state tetap di index.html.
  onInstanceReady(newInstance, isMobile);
  newInstance.render();
}

/**
 * Render & buka modal detail transaksi per tanggal (elemen
 * `#modalCalendarDetail`): daftar transaksi hari itu, plus -- kalau
 * tanggalnya di MASA DEPAN -- item transaksi berulang yg terjadwal jatuh
 * tempo persis di tanggal itu (proyeksi, ditandai jelas berbeda).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {string} dateStr - tanggal YYYY-MM-DD yg diklik.
 * @param {(tanggalStr: string) => Date} ctx.parseTgl
 * @param {Array<object>} ctx.globalData
 * @param {() => string} ctx.todayDateStr
 * @param {Array<object>} ctx.globalRecurring
 * @param {(item: object, opts: {untilDateStr: string, advanceDueDate: Function}) => string[]} ctx.projectRecurringDueDates -
 *   dari src/domain/calendar.js (via servicesModule).
 * @param {(item: object) => string} ctx.advanceDueDate - dari src/domain/recurring.js (via servicesModule).
 * @param {(kategori: string, jenis: string) => object} ctx.getCategoryStyle
 * @param {(style: object, wrapClass?: string, iconSizeClass?: string) => string} ctx.categoryIconHtml
 * @param {(str: string) => string} ctx.escapeHtml
 * @param {(platform: string) => string} ctx.getAccountLogo
 * @param {(angka: number) => string} ctx.formatRp
 * @param {Record<string, string>} ctx.RECURRING_FREQ_LABEL
 */
export function openCalendarDetail({
  document, dateStr, parseTgl, globalData, todayDateStr, globalRecurring,
  projectRecurringDueDates, advanceDueDate,
  getCategoryStyle, categoryIconHtml, escapeHtml, getAccountLogo, formatRp, RECURRING_FREQ_LABEL,
}) {
  document.getElementById("calendarDetailTitle").innerText = "Transaksi " + parseTgl(dateStr).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  let dayData = globalData.filter(d => d.tanggal.startsWith(dateStr));
  let container = document.getElementById("calendarDetailContent");

  // TAMBAHAN: kalau tanggal yg diklik ada di MASA DEPAN, cek juga apakah ada transaksi
  // berulang yg terjadwal jatuh tempo persis di tanggal itu -- supaya modal ini juga
  // berguna buat "apa yang AKAN terjadi", bukan cuma "apa yg sudah terjadi". Item ini
  // murni proyeksi (belum benar-benar tercatat), ditandai jelas beda dari transaksi asli.
  // Deteksi proyeksi: satu sumber kebenaran sekarang src/domain/calendar.js
  // (projectRecurringDueDates) -- sama persis yang dipakai renderCalendar().
  let scheduledItems = [];
  if (dateStr > todayDateStr()) {
    (globalRecurring || []).filter(r => r.active).forEach(item => {
      const dueDates = projectRecurringDueDates(item, { untilDateStr: dateStr, advanceDueDate });
      if (dueDates.includes(dateStr)) scheduledItems.push(item);
    });
  }

  if (dayData.length === 0 && scheduledItems.length === 0) { container.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Tidak ada transaksi.</p>'; }
  else {
    let html = dayData.map(row => {
      let color = row.jenis === "Pemasukan" ? "text-emerald-500" : (row.jenis === "Pengeluaran" ? "text-rose-500" : "text-blue-500");
      let prefix = row.jenis === "Pengeluaran" ? "-" : (row.jenis === "Pemasukan" ? "+" : "");
      let style = getCategoryStyle(row.kategori, row.jenis);
      return `
        <div class="flex justify-between items-center py-3 px-2">
            <div class="flex items-center">
                ${categoryIconHtml(style, "w-8 h-8 rounded-full flex items-center justify-center mr-3 shadow-sm border border-slate-50", "text-sm")}
                <div>
                    <p class="text-sm font-bold text-slate-800">${row.jenis === "Transfer" ? "Transfer ke " + escapeHtml(row.kategori) : escapeHtml(row.kategori)}</p>
                    <p class="text-[10px] md:text-xs text-slate-400 flex items-center mt-0.5"><span class="w-3 h-3 mr-1 inline-block">${getAccountLogo(row.akun)}</span> ${escapeHtml(row.akun)} ${row.keterangan ? "• " + escapeHtml(row.keterangan) : ""}</p>
                </div>
            </div>
            <div class="text-right text-sm font-bold ${color}">${prefix}${row.mata_uang && row.mata_uang !== "IDR" ? row.mata_uang + " " : "Rp "}${formatRp(row.jumlah)}</div>
        </div>`;
    }).join("");
    if (scheduledItems.length > 0) {
      html += `<div class="text-[10px] font-bold text-violet-500 uppercase px-2 pt-3 pb-1.5 ${dayData.length > 0 ? "border-t border-slate-100 mt-2" : ""}"><i class="fas fa-repeat mr-1"></i>Terjadwal (belum tercatat)</div>` +
        scheduledItems.map(item => {
          let style = getCategoryStyle(item.kategori, item.jenis);
          let prefix = item.jenis === "Pengeluaran" ? "-" : (item.jenis === "Pemasukan" ? "+" : "");
          return `
            <div class="flex justify-between items-center py-3 px-2 opacity-70">
                <div class="flex items-center">
                    ${categoryIconHtml(style, "w-8 h-8 rounded-full flex items-center justify-center mr-3 border border-dashed border-violet-200", "text-sm")}
                    <div>
                        <p class="text-sm font-bold text-slate-600">${escapeHtml(item.keterangan || item.kategori)}</p>
                        <p class="text-[10px] md:text-xs text-slate-400">${RECURRING_FREQ_LABEL[item.frequency] || item.frequency}</p>
                    </div>
                </div>
                <div class="text-right text-sm font-bold text-violet-400">${prefix}Rp ${formatRp(item.jumlah)}</div>
            </div>`;
        }).join("");
    }
    container.innerHTML = html;
  }
  document.getElementById("modalCalendarDetail").classList.remove("hidden");
}
