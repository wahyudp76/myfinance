/**
 * MyFinance UI rendering utk bagian BULAN-SPESIFIK halaman Kategori Detail:
 * label bulan, total bulan ini, & chart tren harian (bar Chart.js dgn
 * sparse label utk chart sempit).
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, buat instance Chart). Bedanya dengan sebelum
 * dipindah: semua dependency (elemen `document`, state bulan/jenis/data
 * kategori, helper parse/format/animasi, holder chart, kelas Chart, fungsi
 * domain) SEKARANG disuntik lewat 1 objek `ctx`, bukan dibaca dari
 * closure/global langsung -- supaya (a) eksplisit apa saja yang dibutuhkan
 * fungsi ini, (b) tetap bisa dites tanpa browser sungguhan (lihat
 * tests/unit/ui-categories.test.js: `document` & `Chart` di-stub pakai
 * objek biasa, tidak butuh jsdom/Playwright).
 *
 * Yang SENGAJA TIDAK ikut pindah (tetap fungsi global di index.html):
 * openCategoryDetail (action + penulis state kategori detail + render
 * "Semua Riwayat Transaksi") & categoryDetailShiftMonth (action geser
 * bulan, dirujuk onclick panah kiri/kanan). State-nya
 * (categoryDetailYear/Month/Jenis/SpecificData) juga tetap dimiliki
 * index.html -- fungsi ini hanya MEMBACANYA lewat ctx, dipasok per
 * pemanggilan oleh wrapper.
 *
 * CATATAN window: fallback lebar container memakai window.innerWidth
 * (global browser) persis kode lama -- hanya dievaluasi kalau clientWidth
 * container falsy (container tersembunyi). Di test, stub selalu memberi
 * clientWidth > 0 supa fallback tidak dievaluasi.
 *
 * Chart & charts di-inject per pemanggilan (bukan ditangkap sekali) karena
 * holder `charts` bisa di-reassign utuhnya di index.html (mis. saat ganti
 * tema) -- pola yang sama dgn src/ui/assets.js & src/ui/budgets.js.
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola keenam setelah
 * src/ui/recurring.js (13d8a37), insights.js (af8b4a2), goals-debts.js
 * (089aa40), assets.js (7e021b6) & budgets.js (b1ea0a8). Pasangan
 * domain-nya: src/domain/categories.js (computeCategoryDetailMonthChart,
 * commit bfebff1) + src/domain/chart-labels.js (isChartNarrow &
 * selectSparseLabelIndices, commit e354566).
 */

/**
 * Render bagian bulan-spesifik halaman Kategori Detail: label bulan
 * (elemen `#detail-category-month-label`), total bulan ini
 * (`#detail-category-total`, lewat animateRupiah), & chart tren harian
 * (`#catTrendChart`). Dipisah dari openCategoryDetail() supaya bisa
 * dipanggil ulang sendiri saat geser bulan (categoryDetailShiftMonth),
 * tanpa perlu render ulang seluruh "Semua Riwayat Transaksi".
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {number} ctx.year - tahun yg ditampilkan (categoryDetailYear di index.html).
 * @param {number} ctx.month - bulan 1-12 yg ditampilkan (categoryDetailMonth).
 * @param {string} ctx.jenis - 'Pemasukan' | 'Pengeluaran' (categoryDetailJenis).
 * @param {Array<object>} ctx.specificData - transaksi kategori ini semua bulan (categoryDetailSpecificData).
 * @param {(specificData: Array<object>, year: number, month: number, opts: {parseTgl: Function, txIdrAmount: Function}) => {totalMonth: number, dailyLabels: string[], dailyData: number[]}} ctx.computeCategoryDetailMonthChart -
 *   dari src/domain/categories.js (via servicesModule).
 * @param {(tanggalStr: string) => Date} ctx.parseTgl - helper parse tanggal di index.html.
 * @param {(t: object) => number} ctx.txIdrAmount - helper nilai IDR transaksi di index.html.
 * @param {(el: object, targetValue: number, maskable?: boolean) => void} ctx.animateRupiah
 * @param {(containerWidth: number, barCount: number) => boolean} ctx.isChartNarrow - dari src/domain/chart-labels.js (via servicesModule).
 * @param {(data: number[], maxLabels: number) => Set<number>} ctx.selectSparseLabelIndices - dari src/domain/chart-labels.js (via servicesModule); dipanggil HANYA kalau chart sempit.
 * @param {() => string} ctx.chartGridColor - warna grid chart (mode gelap/terang).
 * @param {(angka: number) => string} ctx.formatShortVal
 * @param {Function} ctx.Chart - kelas Chart.js (global browser, di-inject supaya testable).
 * @param {Record<string, object>} ctx.charts - holder instance chart milik index.html (di-inject per pemanggilan).
 */
export function renderCategoryDetailMonthData({
  document, year, month, jenis, specificData,
  computeCategoryDetailMonthChart, parseTgl, txIdrAmount,
  animateRupiah, isChartNarrow, selectSparseLabelIndices,
  chartGridColor, formatShortVal, Chart, charts,
}) {
  document.getElementById("detail-category-month-label").innerText =
    new Date(year, month - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  // Total bulan & tren harian: satu sumber kebenaran sekarang src/domain/categories.js
  // (dipakai juga oleh tests/unit/categories-domain.test.js).
  const { totalMonth, dailyLabels: chartLabels, dailyData: chartData } =
    computeCategoryDetailMonthChart(specificData, year, month, { parseTgl, txIdrAmount });
  animateRupiah(document.getElementById("detail-category-total"), totalMonth);

  // Sama seperti chart "Tren Transaksi" / "Tren Saldo-Arus Kas" Detail Akun -- kalau
  // chart-nya sempit, batasi cuma beberapa batang paling signifikan yang dikasih label,
  // dengan jarak minimal antar batang berlabel, supaya tidak numpuk. Batang lain tetap
  // bisa dilihat lewat tap (tooltip). "Sempit?" dicek dari lebar CONTAINER dibagi jumlah
  // batang (BUKAN window.innerWidth -- lihat catatan BUG FIX di chart Detail Akun),
  // ketiga chart ini sekarang satu sumber kebenaran di src/domain/chart-labels.js.
  const catChartContainerWidth = document.getElementById("catTrendChart").parentElement.clientWidth || window.innerWidth;
  const catChartIsNarrow = isChartNarrow(catChartContainerWidth, chartData.length);
  const catLabelIndicesToShow = catChartIsNarrow ? selectSparseLabelIndices(chartData, 5) : null;

  if (charts.catTrend) charts.catTrend.destroy();
  charts.catTrend = new Chart(document.getElementById("catTrendChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: chartLabels,
      datasets: [{
        label: "Total",
        data: chartData,
        backgroundColor: jenis === "Pemasukan" ? "#34d399" : "#fb7185",
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: (ctx) => {
            if (!(ctx.dataset.data[ctx.dataIndex] > 0)) return false;
            if (catLabelIndicesToShow && !catLabelIndicesToShow.has(ctx.dataIndex)) return false;
            return true;
          },
          color: jenis === "Pemasukan" ? "#047857" : "#be123c", font: { size: 8, weight: "bold" }, formatter: (v) => formatShortVal(v), anchor: "end", align: "top", offset: 2
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9, weight: "bold" } } },
        // Grid putus-putus & elegan sebagai garis batas antar nilai (konsisten dgn
        // chart "Tren Transaksi") -- lebih jelas terbaca dibanding garis solid polos.
        y: { grid: { color: chartGridColor(), borderDash: [4, 4] }, ticks: { font: { size: 9 }, callback: (v) => formatShortVal(v) } }
      }
    }
  });
}
