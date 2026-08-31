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
  chartGridColor, formatShortVal, accentColor, Chart, charts,
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
        backgroundColor: jenis === "Pemasukan" ? ((accentColor && accentColor("incomeBar")) || "#34d399") : "#fb7185",
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
          color: jenis === "Pemasukan" ? ((accentColor && accentColor("incomeLabel")) || "#047857") : "#be123c", font: { size: 8, weight: "bold" }, formatter: (v) => formatShortVal(v), anchor: "end", align: "top", offset: 2
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

import { pickChartPalette } from "../domain/chart-palette.js";

/**
 * Palet warna proporsi sub-kategori -- sumber kebenaran kini di
 * domain/chart-palette.js (Tier-3 #11); ekspor ini dipertahankan sbg
 * fallback bawaan (kompatibilitas pemanggil lama + unit test).
 * Urutan: indigo -> violet -> cyan -> fuchsia -> emerald -> amber ->
 * rose -> blue -> teal -> slate.
 */
export const SUB_SHARE_COLORS = pickChartPalette("default");

/**
 * Render kartu "Proporsi Sub-Kategori" (slice proporsi sub): donat Chart.js
 * (cutout 72%, glow lembut, total di tengah) + daftar bar proporsi beranimasi
 * per sub-kategori bulan aktif. Konten diarahkan ke #cat-sub-proportion
 * (kartu statisnya ada di markup index.html); instance chart disimpan di
 * ctx.charts.catSubDonut (di-destroy tiap render ulang, pola chart lain).
 *
 * Kasus <2 slice (belum ada pembanding): empty-state ramah + chart lama
 * (kalau ada) di-destroy -- jangan menyisakan donat basi saat geser bulan.
 *
 * @param {object} ctx - pola injeksi yang sama dengan renderCategoryDetailMonthData.
 * Tambahan spesifik: categoryName (nama parent utk label "(langsung)"),
 * aggregateSubCategoryShares (domain), formatRp, escapeHtml, chartBorderColor,
 * requestAnimationFrame (animasi lebar bar dari 0 -> target).
 */
/**
 * Format Rupiah RINGKAS gaya Indonesia (slice polish angka): 1,2 T / 3,4 M
 * (miliar) / 1,55 jt / 900 rb / angka utuh. Desimal koma, nol desimal dibuang
 * ("2 jt", bukan "2,0 jt"). Dipakai pusat donat & bar proporsi supaya angka
 * besar mudah dibaca sekilas; nilai persis tetap ada di tooltip.
 */
export function formatRupiahShort(n) {
  const v = Math.abs(n);
  // desimal adaptif: 1,55 jt / 1,6 jt / 12 jt -- presisi justru di angka kecil
  const fmt = (x) => {
    const d = x < 10 ? 2 : x < 100 ? 1 : 0;
    // trim nol HANYA di bagian desimal (900 tetap "900", 1,60 -> "1,6", 1,00 -> "1")
    const [int, dec] = x.toFixed(d).split(".");
    const dd = (dec || "").replace(/0+$/, "");
    return dd ? int + "," + dd : int;
  };
  if (v >= 1e12) return fmt(n / 1e12) + " T";
  if (v >= 1e9) return fmt(n / 1e9) + " M";
  if (v >= 1e6) return fmt(n / 1e6) + " jt";
  if (v >= 1e3) return fmt(n / 1e3) + " rb";
  return String(n);
}

/**
 * Render kartu "Proporsi Sub-Kategori" (slice proporsi sub + polish angka):
 * donat Chart.js (cutout 72%, glow, PERSSEN di tiap segmen via datalabels --
 * wajib dikonfigurasi eksplisit karena plugin DataLabels ter-register GLOBAL
 * di app; tanpa ini angka mentah bakal numpuk di segmen) + total ringkas di
 * pusat (formatRupiahShort besar + nilai penuh kecil) + daftar bar proporsi
 * beranimasi dengan PILL persen ber-tint & nominal ringkas.
 */
/**
 * Kartu tooltip EKSTERNAL (revisi #3): konten HTML tooltip proporsi yang
 * digambar DI LUAR kanvas (elemen .cat-sub-tip di bawah donat) -- hitam
 * MURNI #000 solid, tidak mungkin menimpa chart. Murni + ter-unit-test.
 */
export function buildSubTipHtml(it, { formatRp, fmtPct, color, escapeHtml }) {
  return `<div class="inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-lg transition-opacity" style="background:#000000" role="status">
    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color};box-shadow:0 0 8px ${color}99"></span>
    <span class="text-xs md:text-sm font-extrabold text-white whitespace-nowrap">${escapeHtml(it.name)}</span>
    <span class="text-xs md:text-sm font-bold text-slate-200 whitespace-nowrap tabular-nums">Rp ${formatRp(it.total)} \u2022 ${fmtPct(it.pct)}</span>
  </div>`;
}

export function renderCategorySubProportion({
  chartPalette = null,
  document, year, month, jenis, categoryName, specificData,
  aggregateSubCategoryShares, parseTgl, txIdrAmount,
  formatRp, escapeHtml, chartBorderColor, Chart, charts, requestAnimationFrame,
}) {
  const host = document.getElementById("cat-sub-proportion");
  if (!host) return;

  const { items, totalMonth } =
    aggregateSubCategoryShares(specificData, year, month, { parseTgl, txIdrAmount });
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("id-ID", { month: "long" });
  const fmtPct = (p) => (p % 1 === 0 ? String(p) : p.toFixed(1).replace(".", ",")) + "%";
  const tipHint = `<span class="text-[10px] text-slate-400"><i class="fas fa-hand-pointer mr-1"></i>Ketuk segmen untuk detail</span>`;

  if (!items || items.length < 2) {
    if (charts.catSubDonut) { charts.catSubDonut.destroy(); delete charts.catSubDonut; }
    host.innerHTML = `
      <div class="text-center py-8 text-slate-400 stagger-item">
        <i class="fas fa-chart-pie text-3xl mb-2"></i>
        <p class="text-xs font-semibold">Belum ada perbandingan proporsi pada ${escapeHtml(monthLabel)} ini.</p>
        <p class="text-[11px] mt-1">Proporsi sub-kategori muncul otomatis saat ada transaksi di 2 sub berbeda bulan ini.</p>
      </div>`;
    return;
  }

  // Tier-3 #11: palet bisa dioverride pemanggil (pilihan pengguna di Pengaturan);
  // fallback tetap palet lama demi kompatibilitas.
  const palette = (Array.isArray(chartPalette) && chartPalette.length) ? chartPalette : SUB_SHARE_COLORS;
  const colors = items.map((_, i) => palette[i % palette.length]);
  const labelOf = (it) =>
    categoryName && it.name === categoryName ? `${it.name} (langsung)` : it.name;

  const rows = items.map((it, i) => {
    const c = colors[i];
    return `
      <div>
        <div class="flex items-center justify-between mb-1.5 gap-2">
          <div class="flex items-center min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 mr-2" style="background:${c};box-shadow:0 0 8px ${c}66"></span>
            <span class="text-xs md:text-sm font-bold text-slate-700 truncate">${escapeHtml(labelOf(it))}</span>
            <span class="text-[10px] text-slate-400 ml-2 flex-shrink-0">${it.count}x</span>
          </div>
          <div class="flex items-center flex-shrink-0">
            <span class="text-[10px] md:text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap mr-2">Rp ${formatRupiahShort(it.total)}</span>
            <span class="text-[11px] md:text-xs font-extrabold tabular-nums rounded-full px-2 py-0.5" style="background:${c}1f;color:${c}">${fmtPct(it.pct)}</span>
          </div>
        </div>
        <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full cat-sub-fill" data-w="${it.pct}" style="width:0%;background:linear-gradient(90deg,${c},${c}8c)"></div>
        </div>
      </div>`;
  }).join("");

  host.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-5 md:gap-6 items-center">
      <div class="lg:col-span-2 flex flex-col items-center">
        <div class="relative w-44 h-44 md:w-52 md:h-52" style="filter:drop-shadow(0 8px 24px rgba(99,102,241,.28))">
          <canvas id="catSubDonut" class="absolute inset-0 w-full h-full"></canvas>
          <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style="padding:0 30px">
            <p class="text-[10px] font-bold uppercase tracking-widest" style="color:#6366f1">Total ${escapeHtml(jenis === "Pemasukan" ? "Masuk" : "Keluar")}</p>
            <p class="text-xl md:text-2xl font-extrabold text-slate-800 leading-tight tabular-nums">${formatRupiahShort(totalMonth)}</p>
            <p class="text-[10px] text-slate-400 tabular-nums">Rp ${formatRp(totalMonth)}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(monthLabel)}</p>
          </div>
        </div>
        <div class="cat-sub-tip w-full flex items-center justify-center min-h-[60px] mt-3">${tipHint}</div>
      </div>
      <div class="lg:col-span-3 space-y-3 md:space-y-4">${rows}</div>
    </div>`;

  if (charts.catSubDonut) charts.catSubDonut.destroy();
  charts.catSubDonut = new Chart(document.getElementById("catSubDonut").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: items.map(labelOf),
      datasets: [{
        data: items.map((it) => it.total),
        backgroundColor: colors,
        borderColor: chartBorderColor(),
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      animation: { animateRotate: true, duration: 900 },
      plugins: {
        legend: { display: false },
        // WAJIB eksplisit: DataLabels ter-register GLOBAL (index.html) --
        // tanpa konfigurasi ini angka mentah ditampilkan otomatis di segmen.
        // Revisi polish #2 (feedback pemilik): label di segmen DIPADAMKAN --
        // band donat tipis (cutout 72%) bikin angka bertabrakan dgn teks pusat.
        // Persen sudah tampil jelas & bebas tabrakan di pill tiap bar sub-kategori
        // + tooltip; donat kini murni bentuk visual proporsi.
        datalabels: { display: false },
        tooltip: {
          // Revisi #3 (feedback pemilik + forensik screenshot 372x177):
          // tooltip internal Chart.js -- apa pun warnanya -- SELALU digambar
          // menimpa kanvas; di donat kecil layar HP kotak 136px menutupi
          // teks pusat (tumpang tindih). Solusi: tooltip DIGAMBAR DI LUAR
          // kanvas sebagai kartu hitam MURNI #000 di bawah donat.
          // PENTING: JANGAN enabled:false -- itu mematikan tooltip SEMPURNA
          // (handler external tak pernah dipanggil; terbukti di uji hover).
          // Kehadiran `external` saja sudah mengganti penggambaran internal.
          // animation:false -> opacity langsung 1 saat hover (tanpa fade
          // internal Chart.js; kartu punya transisi CSS sendiri).
          animation: false,
          external: (ctx) => {
            const tipEl = host.querySelector(".cat-sub-tip");
            if (!tipEl) return;
            const tp = ctx.tooltip;
            const dp = tp && tp.dataPoints && tp.dataPoints[0];
            const idx = dp ? dp.dataIndex : -1;
            const it = idx >= 0 ? items[idx] : null;
            tipEl.innerHTML = (tp && tp.opacity > 0 && it)
              ? buildSubTipHtml(it, { formatRp, fmtPct, color: colors[idx], escapeHtml })
              : tipHint;
          },
        },
      },
    },
  });

  const fills = host.querySelectorAll(".cat-sub-fill");
  const apply = () => fills.forEach((el) => {
    const target = Math.max(2, Math.min(100, parseFloat(el.dataset.w) || 0));
    el.style.width = target + "%";
  });
  if (requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(apply));
  else apply();
}
