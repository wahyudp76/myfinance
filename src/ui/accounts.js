/**
 * MyFinance UI rendering utk bagian GRAFIK halaman Detail Akun: chart garis
 * Saldo akun, chart bar Arus Kas (Masuk/Keluar per bucket dgn sparse-label
 * utk layar sempit), & doughnut Distribusi Kategori Pengeluaran dgn filter
 * rentang kalender independen + legenda donut-nya.
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca elemen, buat instance Chart). Bedanya dengan sebelum
 * dipindah: semua dependency (elemen `document`, data global, state akun
 * yang dibuka, helper format/parse, palet warna, holder chart, kelas
 * Chart, fungsi domain) SEKARANG disuntik lewat 1 objek `ctx`, bukan
 * dibaca dari closure/global langsung -- supaya (a) eksplisit apa saja
 * yang dibutuhkan fungsi ini, (b) tetap bisa dites tanpa browser
 * sungguhan (lihat tests/unit/ui-accounts.test.js: `document` & `Chart`
 * di-stub pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * Yang SENGAJA TIDAK ikut pindah (tetap fungsi global di index.html):
 * openAccountDetail (action buka halaman + penulis state currentAccountDetail
 * + render ringkasan & riwayat transaksi) & toggleAccountCatFilter (action
 * ganti filter kategori, dirujuk onchange di markup). State
 * currentAccountDetail juga tetap dimiliki index.html (dibaca juga alur
 * refresh data) -- fungsi ini hanya MEMBACANYA lewat ctx.
 *
 * CATATAN cutePaletteOut: palet ini dideklarasikan BELAKANG fungsi ini di
 * index.html (top-level const yg baru terinisialisasi setelah seluruh
 * script jalan) -- aman karena fungsi baru DIEKSEKUSI setelah itu; sekarang
 * di-inject per pemanggilan lewat ctx, jadi urutan deklarasi tidak lagi
 * relevan. window.innerWidth dipakai HANYA sebagai fallback lebar container
 * (persis kode lama; dievaluasi kalau clientWidth falsy).
 *
 * Chart & charts di-inject per pemanggilan (pola assets/budgets/calendar).
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola kedelapan setelah
 * src/ui/recurring.js (13d8a37), insights.js (af8b4a2), goals-debts.js
 * (089aa40), assets.js (7e021b6), budgets.js (b1ea0a8), categories.js
 * (3de2ad7) & calendar.js (2902085). Pasangan domain-nya:
 * src/domain/accounts.js (buildAccountBalanceSeries, computeAccountChartSeries,
 * resolveAccountCategoryDateRange, aggregateAccountExpenseByCategory,
 * commit 3181fc0/85627e7) + src/domain/chart-labels.js.
 */

/**
 * Render 3 chart + legenda halaman Detail Akun:
 * 1. Garis Saldo (`#accountBalanceChart`) dari deret saldo penuh.
 * 2. Bar Arus Kas (`#accountDetailChart`) Masuk/Keluar per bucket
 *    (hari/minggu/bulan sesuai `#accountDetailPeriod`), sparse-label utk
 *    layar sempit (batas 4 krn ada 2 dataset per titik).
 * 3. Doughnut Distribusi Kategori Pengeluaran (`#accountCatChart`) dgn
 *    rentang filter INDEPENDEN (`#accountCatFilterType` + Month) + legenda
 *    (renderDonutBreakdown) yg tiap itemnya bisa diklik ke detail kategori.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {string|null} ctx.currentAccountDetail - nama akun yg sedang dibuka (guard: null -> no-op).
 * @param {Array<object>} ctx.globalData - semua transaksi.
 * @param {(row: object) => number} ctx.transferTargetAmount - helper nilai sisi tujuan transfer di index.html.
 * @param {(tanggalStr: string) => Date} ctx.parseTgl
 * @param {(globalData: Array<object>, accName: string, opts: object) => Array<object>} ctx.buildAccountBalanceSeries -
 *   dari src/domain/accounts.js (via servicesModule).
 * @param {(fullSeries: Array<object>, periodVal: string, opts: {now: Date}) => {cutoff: Date, bucketLabels: string[], cashInData: number[], cashOutData: number[], balanceLabels: string[], balanceChartData: number[]}} ctx.computeAccountChartSeries -
 *   dari src/domain/accounts.js (via servicesModule).
 * @param {(containerWidth: number, barCount: number) => boolean} ctx.isChartNarrow - dari src/domain/chart-labels.js (via servicesModule).
 * @param {(magnitudes: number[], maxLabels: number) => Set<number>} ctx.selectSparseLabelIndices - dari src/domain/chart-labels.js (via servicesModule); dipanggil HANYA kalau sempit.
 * @param {(filterType: string, opts: {now: Date, syncCutoff: Date, customMonthStr: string|null}) => {start: Date, end: Date}} ctx.resolveAccountCategoryDateRange -
 *   dari src/domain/accounts.js (via servicesModule).
 * @param {(globalData: Array<object>, accName: string, opts: object) => {entries: Array<{label: string, val: number}>}} ctx.aggregateAccountExpenseByCategory -
 *   dari src/domain/accounts.js (via servicesModule).
 * @param {(kategori: string, jenis: string) => object} ctx.getCategoryStyle
 * @param {(style: object, wrapClass?: string, iconSizeClass?: string) => string} ctx.categoryIconHtml
 * @param {(str: string) => string} ctx.jsStr - escape utk atribut onclick="...".
 * @param {(angka: number) => string} ctx.formatRp
 * @param {(angka: number) => string} ctx.formatShortVal
 * @param {() => string} ctx.chartGridColor - warna grid (mode gelap/terang).
 * @param {(bg: string) => string} ctx.chartLabelColor - mapping warna label di atas batang.
 * @param {() => string} ctx.chartEmptyColor - warna segmen donut kosong.
 * @param {() => string} ctx.chartBorderColor - warna garis pemisah segmen donut.
 * @param {string[]} ctx.cutePaletteOut - palet pastel kategori pengeluaran (dideklarasikan di index.html).
 * @param {(opts: object) => void} ctx.renderDonutBreakdown - renderer legenda donut di index.html.
 * @param {Function} ctx.Chart - kelas Chart.js (global browser, di-inject supaya testable).
 * @param {Record<string, object>} ctx.charts - holder instance chart milik index.html (di-inject per pemanggilan).
 */
import { hudLineDataset, hudLineScales, hudGlowPlugin, hudBarDataset, hudDonutSegment, hudDonutGlowPlugin } from "../domain/chart-hud.js";

export function renderAccountDetailCharts({
  document, currentAccountDetail, globalData, transferTargetAmount, parseTgl,
  buildAccountBalanceSeries, computeAccountChartSeries, isChartNarrow, selectSparseLabelIndices,
  resolveAccountCategoryDateRange, aggregateAccountExpenseByCategory,
  getCategoryStyle, categoryIconHtml, jsStr, formatRp, formatShortVal,
  chartGridColor, chartLabelColor, chartEmptyColor, chartBorderColor,
  cutePaletteOut, renderDonutBreakdown, accentColor, Chart, charts,
}) {
  if (!currentAccountDetail) return;
  const accName = currentAccountDetail;
  const periodSelect = document.getElementById("accountDetailPeriod");
  const periodVal = periodSelect ? periodSelect.value : "180";
  const fullSeries = buildAccountBalanceSeries(globalData, accName, { transferTargetAmount, parseTgl });
  const now = new Date();

  // Granularitas bucket (hari/minggu/bulan) & agregasi Saldo/Arus-Kas: satu sumber
  // kebenaran sekarang src/domain/accounts.js (dipakai juga oleh
  // tests/unit/accounts-domain.test.js).
  const { cutoff, bucketLabels, cashInData, cashOutData, balanceLabels, balanceChartData } =
    computeAccountChartSeries(fullSeries, periodVal, { now });

  if (charts.accBalance) charts.accBalance.destroy();
  if (document.getElementById("accountBalanceChart")) {
    charts.accBalance = new Chart(document.getElementById("accountBalanceChart").getContext("2d"), {
      type: "line",
      data: {
        labels: balanceLabels,
        datasets: [{
          label: "Saldo", data: balanceChartData,
          // DNA grafik "Tren Saldo Kas & Rekening" (src/domain/chart-hud.js).
          ...hudLineDataset({ from: "#3b82f6", to: "#22d3ee", fill: "#3b82f6", points: balanceLabels.length })
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false }, datalabels: { display: false },
          tooltip: { callbacks: { label: (ctx) => "Saldo: Rp " + formatRp(ctx.raw) } }
        },
        scales: hudLineScales(balanceLabels, formatShortVal, { yGrid: chartGridColor() })
      },
      plugins: [hudGlowPlugin]
    });
  }

  if (charts.accCashflow) charts.accCashflow.destroy();
  if (document.getElementById("accountDetailChart")) {
    // Sama seperti chart "Tren Transaksi"/"Tren Kategori" -- di layar sempit (HP), cuma
    // beberapa titik (bucket) paling signifikan yang dikasih label, dengan jarak minimal
    // antar titik berlabel. Di sini ADA 2 dataset (Masuk & Keluar) per titik, jadi total
    // teksnya 2x lebih padat -- batasnya dibuat lebih ketat (4, bukan 5) dari chart 1
    // dataset. Titik yg tidak kepilih tetap ada batangnya, cuma tanpa angka di atasnya --
    // detail nilainya tetap bisa dilihat lewat tap (tooltip).
    //
    // "Sempit?" dicek dari lebar CONTAINER chart (bukan window.innerWidth -- chart ini
    // duduk berdampingan 2-kolom bareng chart "Tren Saldo Akun", jadi window lebar tidak
    // berarti canvas-nya lebar) dibagi jumlah titik data. Ketiga chart bar di app ini
    // (chart ini, "Tren Transaksi", "Tren Kategori") sekarang satu sumber kebenaran di
    // src/domain/chart-labels.js (dipakai juga oleh tests/unit/chart-labels.test.js).
    const cashflowContainerWidth = document.getElementById("accountDetailChart").parentElement.clientWidth || window.innerWidth;
    const cashflowIsNarrow = isChartNarrow(cashflowContainerWidth, bucketLabels.length);
    const cashflowMagnitudes = bucketLabels.map((_, i) => Math.abs(cashInData[i] || 0) + Math.abs(cashOutData[i] || 0));
    const cashflowIndicesToShow = cashflowIsNarrow ? selectSparseLabelIndices(cashflowMagnitudes, 4) : null;

    charts.accCashflow = new Chart(document.getElementById("accountDetailChart").getContext("2d"), {
      plugins: [hudGlowPlugin], // DNA batang HUD: glow cyan
      type: "bar",
      data: {
        labels: bucketLabels,
        datasets: [
          { label: "Masuk", data: cashInData, ...hudBarDataset({ from: (accentColor && accentColor("incomeBar")) || "#34d399", borderRadius: 4 }) },
          { label: "Keluar", data: cashOutData, ...hudBarDataset({ from: "#fb7185", borderRadius: 4 }) }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 10, font: { size: 10, weight: "bold" } } },
          datalabels: {
            display: (ctx) => {
              if (!(ctx.dataset.data[ctx.dataIndex] > 0)) return false;
              if (cashflowIndicesToShow && !cashflowIndicesToShow.has(ctx.dataIndex)) return false;
              return true;
            },
            color: (ctx) => chartLabelColor(ctx.datasetIndex === 0 ? ((accentColor && accentColor("incomeBar")) || "#34d399") : "#fb7185"), font: { size: 8, weight: "bold" }, formatter: (v) => formatShortVal(v), anchor: "end", align: "top", offset: 2
          },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": Rp " + formatRp(ctx.raw) } }
        },
        scales: hudLineScales(bucketLabels, formatShortVal, { yGrid: chartGridColor() })
      }
    });
  }

  // Distribusi kategori pengeluaran -- filter INDEPENDEN dari "Rentang Grafik" di atas
  // (opsi "sync" ikut cutoff yang sama; selain itu pakai rentang kalender sendiri: bulan/
  // tahun ini/lalu, atau bulan tertentu yang dipilih).
  const catFilterType = document.getElementById("accountCatFilterType") ? document.getElementById("accountCatFilterType").value : "sync";
  const customMonthStr = catFilterType === "custom" ? document.getElementById("accountCatFilterMonth").value : null; // "YYYY-MM"
  // Resolusi filter kalender & agregasi kategori: satu sumber kebenaran sekarang
  // src/domain/accounts.js (dipakai juga oleh tests/unit/accounts-domain.test.js).
  const { start: catStart, end: catEnd } = resolveAccountCategoryDateRange(catFilterType, { now, syncCutoff: cutoff, customMonthStr });
  const { entries: catEntries } = aggregateAccountExpenseByCategory(globalData, accName, { getCategoryStyle, parseTgl, start: catStart, end: catEnd });
  let hasCatData = catEntries.length > 0;

  if (charts.accCat) charts.accCat.destroy();
  if (document.getElementById("accountCatChart")) {
    charts.accCat = new Chart(document.getElementById("accountCatChart").getContext("2d"), {
      plugins: [hudDonutGlowPlugin], // DNA donut HUD: glow violet reactor
      type: "doughnut",
      data: {
        labels: hasCatData ? catEntries.map(e => e.label) : ["Belum ada pengeluaran"],
        // DNA donut HUD: segmen gradasi komet (palet colorblind tetap sumber warna).
        datasets: [{ data: hasCatData ? catEntries.map(e => e.val) : [1], backgroundColor: hudDonutSegment(hasCatData ? cutePaletteOut : [chartEmptyColor()]), borderWidth: 0, spacing: 6, borderRadius: 5, hoverOffset: 8 }]
      },
      options: {
        // Opsi disamakan dgn donut "Komposisi Kas & Rekening" (cutout 70%).
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        plugins: { legend: { display: false }, datalabels: { display: false } }
      }
    });
    // HUD radar: persen kategori terbesar di tengah cincin (pola "Komposisi Kas & Rekening").
    const accCatRadarEl = document.getElementById("accountCat-radar-pct");
    if (accCatRadarEl) {
      const accCatTot = catEntries.reduce((a, e) => a + Number(e.val || 0), 0);
      const accCatTop = catEntries.reduce((m, e) => (Number(e.val) > Number(m ? m.val : -1) ? e : m), null);
      if (hasCatData && accCatTot > 0 && accCatTop) {
        accCatRadarEl.querySelector("b").textContent = Math.round((Number(accCatTop.val) / accCatTot) * 100) + "%";
        accCatRadarEl.querySelector("span").textContent = String(accCatTop.label).toUpperCase().slice(0, 10);
        accCatRadarEl.style.display = "flex";
      } else { accCatRadarEl.style.display = "none"; }
    }
  }
  renderDonutBreakdown({
    legendEl: document.getElementById("accountCatChart-legend"),
    listEl: document.getElementById("accountCatChart-list"),
    totalEl: document.getElementById("accountCatChart-total"),
    entries: catEntries.map(e => { const s = getCategoryStyle(e.label, "Pengeluaran"); return { label: e.label, val: e.val, iconHtml: categoryIconHtml(s, "w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0", "text-xs md:text-sm") }; }),
    palette: cutePaletteOut,
    onClickItem: (label) => `openCategoryDetail('${jsStr(label)}','Pengeluaran')`,
    emptyMessage: "Belum ada pengeluaran untuk akun ini pada rentang yang dipilih."
  });
}
