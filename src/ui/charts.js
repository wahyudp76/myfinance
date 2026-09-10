/**
 * MyFinance UI -- builder konfigurasi Chart.js untuk SEMUA chart di index.html.
 *
 * Hasil slice monolith (audit 2026-09, rekomendasi #1): config object tiap chart
 * dipindah ke sini sebagai FUNGSI MURNI (tanpa DOM/Chart/global) supaya bisa diuji
 * tanpa browser (tests/unit/ui-charts.test.js). Pemanggilan `new Chart(canvas, ...)`
 * TETAP di index.html -- modul ini hanya membangun object config-nya:
 *
 *   charts.daily = new Chart(el.getContext('2d'),
 *       servicesModule.chartsUi.buildDailyConfig({ ...deps }));
 *
 * Karakter visual semua chart mengikuti DNA HUD (src/domain/chart-hud.js) --
 * lihat komentar "chart-hud" di docs/SESSION-HANDOFF.md. Perilaku config dipindah
 * 1:1 dari index.html (bukan penulisan ulang) -- perubahan visual harus lewat
 * chart-hud.js / builder di sini, bukan diedit inline lagi di index.html.
 */
import {
  hudGlowPlugin,
  hudDonutGlowPlugin,
  hudBarDataset,
  hudLineDataset,
  hudLineScales,
  hudDonutSegment
} from "../domain/chart-hud.js";

// ============================================================================
// TOOLTIP EKSTERNAL DONAT (v115) -- satu sumber kebenaran pola "Proporsi
// Sub-Kategori" (src/ui/categories.js, feedback pemilik: tooltip internal
// Chart.js -- apa pun warnanya -- SELALU digambar menimpa kanvas; di donat
// kecil layar HP kotaknya menutupi segmen & teks pusat). Sejak v115 SEMUA
// donat memakai pola ini: interaksi hover/ketuk segmen menampilkan kartu
// hitam MURNI #000 (kontrak #000, konsisten Chart.defaults tooltip) DI LUAR
// kanvas, berisi "Label Rp <nilai> • <persen>".
// ============================================================================

/** Format persen kartu tip: bulat tanpa desimal, selain itu 1 desimal koma ("65,2%"). */
export function donutTipPct(p) {
  const n = Number(p) || 0;
  return (n % 1 === 0 ? String(n) : n.toFixed(1).replace(".", ",")) + "%";
}

/** Hint idle pada area tip (persis kartu Proporsi Sub-Kategori). */
export const DONUT_TIP_HINT = '<span class="text-[10px] text-slate-400"><i class="fas fa-hand-pointer mr-1"></i>Ketuk segmen untuk detail</span>';

/**
 * Plugin pembatal penggambaran tooltip INTERNAL Chart.js (v116).
 *
 * Forensik vendor/chartjs-4.5.1.min.js: hook afterDraw tooltip menggambar kotak
 * internal setiap kali `tooltip.opacity` truthy -- TIDAK memeriksa `options.external`
 * (klaim lama "kehadiran external saja mengganti penggambaran internal" TIDAK benar;
 * akibatnya kartu eksternal v115 tampil BERSAMA kotak hitam internal yang menutupi
 * donat). `enabled:false` pun tidak menjamin: afterDraw tetap hanya mengecek opacity.
 * Jalur resmi yang PASTI membatalkan penggambaran: hook `beforeTooltipDraw` bersifat
 * CANCELABLE (`notifyPlugins("beforeTooltipDraw", {cancelable: true})` -> `false`
 * = skip `tooltip.draw(ctx)`) -- tanpa mematikan model tooltip: event hover/klik tetap
 * diproses dan handler `external` tetap dipanggil dari Tooltip.update().
 */
export const suppressInternalTooltipPlugin = {
  id: "suppressInternalTooltip",
  beforeTooltipDraw() { return false; },
};

/**
 * Markup kartu tip eksternal (pola buildSubTipHtml di src/ui/categories.js --
 * dipertahankan byte-identik supaya kartu semua donat terlihat sama persis).
 * Warna lewat data-style-* (bukan style=) -- diterapkan applyCspDynamicStyles
 * (MutationObserver) karena CSP tanpa 'unsafe-inline' memblokir style attr.
 */
export function donutTipCardHtml({ label, val, pctText, color, escapeHtml, formatRp }) {
  return `<div class="inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-lg transition-opacity csp-toast-background" role="status">
    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" data-style-background="${color}" data-style-box-shadow="0 0 8px ${color}99"></span>
    <span class="text-xs md:text-sm font-extrabold text-white whitespace-nowrap">${escapeHtml(label)}</span>
    <span class="text-xs md:text-sm font-bold text-slate-200 whitespace-nowrap tabular-nums">Rp ${formatRp(val)} \u2022 ${pctText}</span>
  </div>`;
}

/**
 * Bangun config `tooltip` Chart.js yang menggambar DI LUAR kanvas: menulis kartu
 * ke `tipEl` (elemen di bawah donat) saat tooltip aktif (hover desktop / ketuk
 * mobile), dan mengembalikannya ke hint saat idle.
 *
 * Kenapa `external` (bukan enabled:false): enabled:false mematikan tooltip
 * SEMPURNA -- handler eksternal tidak pernah dipanggil (terbukti di uji hover
 * kartu Proporsi Sub-Kategori). Kehadiran `external` saja sudah mengganti
 * penggambaran internal. animation:false -> opacity langsung 1 (kartu punya
 * transisi CSS sendiri).
 *
 * @returns {null|{animation: boolean, external: Function}} null bila tipEl absen
 *   (pemanggil lama/test tetap dapat tooltip internal default -- perilaku lama).
 */
export function buildExternalDonutTip({ tipEl, labels, data, colors, formatRp, escapeHtml, hintHtml }) {
  if (!tipEl) return null;
  const vals = Array.isArray(data) ? data : [];
  const total = vals.reduce((a, v) => a + (Number(v) || 0), 0);
  return {
    animation: false,
    external(ctx) {
      const tp = ctx && ctx.tooltip;
      const dp = tp && tp.dataPoints && tp.dataPoints[0];
      const idx = dp ? dp.dataIndex : -1;
      const active = !!(tp && tp.opacity > 0 && idx >= 0 && idx < vals.length && total > 0);
      if (active) {
        const val = Number(vals[idx]) || 0;
        const palette = Array.isArray(colors) && colors.length ? colors : ["#6366f1"];
        tipEl.innerHTML = donutTipCardHtml({
          label: labels[idx],
          val,
          pctText: donutTipPct((val / total) * 100),
          color: palette[idx % palette.length],
          escapeHtml,
          formatRp,
        });
      } else {
        tipEl.innerHTML = hintHtml || DONUT_TIP_HINT;
      }
    },
  };
}


/** Dashboard: arus kas bersih harian (bar net +/-, sumbu teknis T/Y, glow). */
export function buildTxTrendConfig({ chartLabels, chartNet, labelIndicesToShow, themeAccentColor, formatShortVal, formatRp, chartGridColor }) {
  return {
    plugins: [hudGlowPlugin],
    type: 'bar',
    data: { labels: chartLabels, datasets: [{
      label: 'Arus Kas Bersih',
      data: chartNet,
      // DNA batang HUD: gradasi neon per batang (hijau utk net +, merah utk net -).
      ...hudBarDataset({ from: chartNet.map(v => v >= 0 ? (themeAccentColor('income500') || '#10b981') : '#f43f5e'), borderRadius: 3 })
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 12, bottom: 22 } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 9, weight: 'bold' } } },
        // Label angka di tiap batang -- di ATAS batang kalau net positif (hijau), di
        // BAWAH batang kalau net negatif (merah), biar tidak nabrak batangnya sendiri.
        // Batang net 0 (hari tanpa transaksi) sengaja tidak dikasih label, biar tidak
        // penuh sesak kalau banyak hari kosong dalam 1 bulan. Di layar sempit, ditambah
        // filter labelIndicesToShow (lihat selectSparseLabelIndices di chart-labels.js).
        datalabels: {
          display: (ctx) => {
            if (ctx.dataset.data[ctx.dataIndex] === 0) return false;
            if (labelIndicesToShow && !labelIndicesToShow.has(ctx.dataIndex)) return false;
            return true;
          },
          color: (ctx) => ctx.dataset.data[ctx.dataIndex] >= 0 ? (themeAccentColor('income600') || '#059669') : '#e11d48',
          font: { size: 8, weight: 'bold' },
          formatter: (v) => (v >= 0 ? '+' : '-') + formatShortVal(Math.abs(v)),
          // SELALU anchor 'end' (ujung nilai batang) -- ini yg terbukti reliable (dipakai
          // jg utk batang positif sebelumnya, hasilnya benar). anchor 'start' SEMPAT
          // dipakai utk batang negatif tapi ternyata jaraknya ke garis 0 tidak konsisten
          // (makin tinggi batangnya, makin nabrak) -- makanya diganti pakai cara di bawah,
          // yang MENGHITUNG SENDIRI tinggi batang itu dlm piksel lalu geser label
          // sejauh itu, supaya PASTI lompat sampai ke atas batang seberapa pun tingginya.
          anchor: 'end',
          align: 'top',
          offset: (ctx) => {
            const v = ctx.dataset.data[ctx.dataIndex];
            if (v >= 0) return 2; // batang positif: anchor sudah di puncak, jarak kecil cukup
            try {
              const el = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.dataIndex];
              if (el && typeof el.base === 'number' && typeof el.y === 'number') {
                return Math.abs(el.base - el.y) + 4; // = tinggi batang (px) + sedikit jarak
              }
            } catch { /* fallback di bawah kalau struktur elemen beda dari dugaan */ }
            return 2;
          }
        },
        tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y >= 0 ? '+Rp ' : '-Rp ') + formatRp(Math.abs(ctx.parsed.y)) } }
      },
      scales: hudLineScales(chartLabels, formatShortVal, { yGrid: chartGridColor() })
    }
  };
}

/** Dashboard: cashflow 7 hari (bar Masuk/Keluar, sumbu y disembunyikan -- widget compact). */
export function buildCashflow7Config({ labels7, last7Order, last7Map, themeAccentColor, formatShortVal, formatRp, chartLabelColor }) {
  return {
    plugins: [hudGlowPlugin],
    type: 'bar',
    data: {
      labels: labels7,
      datasets: [
        // DNA batang HUD (src/domain/chart-hud.js): gradasi neon + casing tipis.
        { label: 'Masuk', data: last7Order.map(k => last7Map[k].in), ...hudBarDataset({ from: (themeAccentColor('incomeBar') || '#34d399') }) },
        { label: 'Keluar', data: last7Order.map(k => last7Map[k].out), ...hudBarDataset({ from: '#fb7185' }) }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 12, bottom: 22 } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 9, weight: 'bold' } } },
        datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: (ctx) => chartLabelColor(ctx.datasetIndex === 0 ? (themeAccentColor('incomeBar') || '#34d399') : '#fb7185'), font: { size: 8, weight: 'bold' }, formatter: (v) => formatShortVal(v), anchor: 'end', align: 'top', offset: 2 },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': Rp ' + formatRp(ctx.raw) } }
      },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9, weight: 'bold' }, color: '#67e8f9' } }, y: { display: false, grid: { display: false } } }
    }
  };
}

/** Dashboard: donut Komposisi Kas & Rekening (ACUAN karakter donut seluruh app). */
export function buildAssetDonutConfig({ assetLabels, assetData, modernPalette, chartEmptyColor, tipEl, formatRp, escapeHtml }) {
  const isEmpty = assetData[0] === 1 && assetLabels[0] === 'Kosong';
  const tip = (tipEl && !isEmpty) ? buildExternalDonutTip({ tipEl, labels: assetLabels, data: assetData, colors: modernPalette, formatRp, escapeHtml }) : null;
  return {
    type: 'doughnut',
    data: { labels: assetLabels, datasets: [{ data: assetData, backgroundColor: hudDonutSegment(isEmpty ? [chartEmptyColor()] : modernPalette), borderWidth: 0, spacing: 6, borderRadius: 5, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      // v117: anggaran ruang pop-out segmen (hoverOffset 8) — Chart.js 4.5.1 TIDAK
      // menganggarkan hoverOffset level-dataset dalam radius luar (getMaxOffset
      // resolve scope non-hover → 0; terbukti radius = (min−spacing)/2), sehingga
      // tanpa padding segmen aktif terdorong MELEWATI tepi kanvas dan terpotong
      // kotak. Kanvas sendiri dibesarkan via .donut-canvas-wrap (meluber 8px ke
      // semua arah) supaya ukuran visual donat TIDAK berubah.
      layout: { padding: 8 },
      plugins: {
        legend: { display: false }, datalabels: { display: false },
        ...(tip ? { tooltip: tip } : {})
      }
    },
    // v116: bersama kartu eksternal, penggambaran tooltip INTERNAL dibatalkan
    // (suppressInternalTooltipPlugin) -- kotak internal menutupi donat.
    plugins: tip ? [hudDonutGlowPlugin, suppressInternalTooltipPlugin] : [hudDonutGlowPlugin]
  };
}

/** Dashboard: arus kas bulanan (bar Masuk/Keluar 6 bulan terakhir). */
export function buildMonthlyConfig({ monthLabels, monthlyMap, themeAccentColor, formatShortVal, chartGridColor, chartLabelColor }) {
  return {
    type: 'bar',
    data: { labels: monthLabels.length ? monthLabels : ['Bulan Ini'], datasets: [{ label: 'Masuk', data: monthLabels.length ? monthLabels.map(l => monthlyMap[l].in) : [0], ...hudBarDataset({ from: (themeAccentColor('income500') || '#10b981') }) }, { label: 'Keluar', data: monthLabels.length ? monthLabels.map(l => monthlyMap[l].out) : [0], ...hudBarDataset({ from: '#f43f5e' }) }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 12, bottom: 22 } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 10, weight: 'bold' } } }, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, color: (ctx) => chartLabelColor(ctx.datasetIndex === 0 ? (themeAccentColor('income500') || '#10b981') : '#f43f5e'), font: { size: 9, weight: 'bold' }, formatter: (v) => formatShortVal(v), anchor: 'end', align: 'top', offset: 2 } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' }, color: '#67e8f9' } }, y: { grace: "10%", grid: { color: chartGridColor() }, ticks: { font: { size: 10 } } } } },
    plugins: [hudGlowPlugin]
  };
}

/** Dashboard: Tren Saldo Kas & Rekening -- chart ACUAN DNA garis seluruh app. */
export function buildBalanceTrendConfig({ trendLabels, trend, lineColor, formatRp, formatShortVal, chartGridColor }) {
  return {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: 'Saldo', data: trend.map(t => t.balance),
        borderColor: (ctx) => { const a = ctx.chart.chartArea; if (!a) return lineColor; const g = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0); g.addColorStop(0, '#22d3ee'); g.addColorStop(1, '#a78bfa'); return g; },
        backgroundColor: (ctx) => { const a = ctx.chart.chartArea; if (!a) return lineColor + '1a'; const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(34,211,238,0.30)'); g.addColorStop(0.65, 'rgba(167,139,250,0.10)'); g.addColorStop(1, 'rgba(167,139,250,0)'); return g; },
        fill: true,
        tension: 0.45, pointStyle: 'crossRot', pointRadius: 6, pointHoverRadius: 9,
        pointBackgroundColor: 'rgba(4,10,20,0.92)', pointBorderColor: '#67e8f9', pointBorderWidth: 2, borderWidth: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: { callbacks: { label: (ctx) => 'Rp ' + formatRp(ctx.parsed.y) } }
      },
      scales: {
        x: { grid: { color: 'rgba(34,211,238,0.07)' }, ticks: { font: { size: 9, weight: 'bold' }, callback: (v, i) => 'T' + String(i + 1).padStart(2, '0') + '·' + trendLabels[i] } },
        y: { grid: { color: chartGridColor() }, ticks: { font: { size: 9 }, callback: (v) => 'Y·' + formatShortVal(v) } }
      }
    },
    plugins: [hudGlowPlugin]
  };
}

/** Modal detail aset: riwayat nilai aset (garis DNA HUD, warna ikut tren naik/turun). */
export function buildAssetDetailConfig({ history, lineColor, isUp, formatRp, formatShortVal, chartGridColor }) {
  const labels = history.map(h => new Date(h.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: history.map(h => h.nilai),
        ...hudLineDataset({ from: lineColor, to: isUp ? '#a78bfa' : '#fb7185', fill: lineColor, points: history.length })
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, datalabels: { display: false },
        tooltip: { callbacks: { label: (ctx) => 'Rp ' + formatRp(ctx.parsed.y) } }
      },
      scales: hudLineScales(labels, formatShortVal, { yGrid: chartGridColor() })
    },
    plugins: [hudGlowPlugin]
  };
}

/** Laporan: net per bulan setahun (bar net +/-, sumbu teknis). */
export function buildYearlyNetConfig({ monthLabels, monthlyNet, themeAccentColor, formatShortVal, chartGridColor }) {
  return {
    type: 'bar',
    data: { labels: monthLabels, datasets: [{ label: 'Arus Kas Bersih', data: monthlyNet, ...hudBarDataset({ from: monthlyNet.map(v => v >= 0 ? (themeAccentColor('incomeBar') || '#34d399') : '#fb7185'), maxBarThickness: 44 }) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 9, weight: 'bold' } } }, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] !== 0, color: (ctx) => ctx.dataset.data[ctx.dataIndex] >= 0 ? (themeAccentColor('incomeBar') || '#34d399') : '#fb7185', font: { size: 8, weight: 'bold' }, formatter: (v) => (v >= 0 ? '+' : '-') + formatShortVal(Math.abs(v)), anchor: 'end', align: 'top', offset: 2 },
        tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y >= 0 ? '+' : '-') + 'Rp' + formatShortVal(Math.abs(ctx.parsed.y)) } } },
      scales: hudLineScales(monthLabels, formatShortVal, { yGrid: chartGridColor() })
    },
    plugins: [hudGlowPlugin]
  };
}

/**
 * Laporan: donut kategori (dipakai catOut & catIn -- satu builder, parameter jenis).
 * Klik segmen membuka detail kategori (kecuali segmen 'Kosong').
 */
export function buildCategoryDonutConfig({ hasData, entries, palette, chartEmptyColor, openCategoryDetail, jenis, tipEl, formatRp, escapeHtml }) {
  const tip = (tipEl && hasData) ? buildExternalDonutTip({ tipEl, labels: entries.map(e => e.label), data: entries.map(e => e.val), colors: palette, formatRp, escapeHtml }) : null;
  return {
    type: 'doughnut',
    data: { labels: hasData ? entries.map(e => e.label) : ['Kosong'], datasets: [{ data: hasData ? entries.map(e => e.val) : [1], backgroundColor: hudDonutSegment(hasData ? palette : [chartEmptyColor()]), borderWidth: 0, spacing: 6, borderRadius: 5, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      // v117: ruang pop-out segmen — lihat catatan di buildAssetDonutConfig.
      layout: { padding: 8 },
      plugins: {
        legend: { display: false }, datalabels: { display: false },
        ...(tip ? { tooltip: tip } : {})
      },
      onHover: (e, elements) => { e.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      onClick: (e, elements, chart) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const label = chart.data.labels[idx];
          if (label !== 'Kosong') openCategoryDetail(label, jenis);
        }
      }
    },
    // v116: bersama kartu eksternal, penggambaran tooltip INTERNAL dibatalkan.
    plugins: tip ? [hudDonutGlowPlugin, suppressInternalTooltipPlugin] : [hudDonutGlowPlugin]
  };
}

/** Laporan: cash flow harian bulan terpilih (2 garis solid + area, legenda atas). */
export function buildDailyConfig({ dailyLabels, dailyMap, formatShortVal, chartGridColor }) {
  return {
    type: 'line',
    data: { labels: dailyLabels, datasets: [{ label: 'Pemasukan', data: dailyLabels.map(d => dailyMap[d].in), ...hudLineDataset({ from: '#10b981', to: '#34d399', fill: '#10b981', points: dailyLabels.length, gradient: false }) }, { label: 'Pengeluaran', data: dailyLabels.map(d => dailyMap[d].out), ...hudLineDataset({ from: '#f43f5e', to: '#fb7185', fill: '#f43f5e', points: dailyLabels.length, gradient: false }) }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } }, datalabels: { display: false } }, scales: hudLineScales(dailyLabels, formatShortVal, { yGrid: chartGridColor() }) },
    plugins: [hudGlowPlugin]
  };
}

/** Laporan: tren N kategori (garis solid per palet + area + glow). */
export function buildCatTrendConfig({ labels, series, palette, formatRp, formatShortVal, chartGridColor }) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data,
        ...hudLineDataset({ from: palette[i % palette.length], gradient: false, points: labels.length })
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 10, weight: 'bold' } } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: Rp ${formatRp(ctx.raw)}` } }
      },
      scales: hudLineScales(labels, formatShortVal, { yGrid: chartGridColor() })
    },
    plugins: [hudGlowPlugin]
  };
}
