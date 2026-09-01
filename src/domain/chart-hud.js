/**
 * Konfigurasi karakter grafik garis HUD -- MURNI (tanpa import DOM/Chart).
 *
 * Acuan karakter: grafik "Tren Saldo Kas & Rekening" (balanceTrend di
 * index.html) -- garis neon gradasi cyan->violet 3px, area gradasi vertikal
 * yang memudar, titik data crosshair (inti gelap + tepi cyan), lengkung halus
 * tension 0.45, glow cyan (hudGlowPlugin), dan sumbu koordinat teknis
 * (grid cyan tipis + tick "T01·label" / "Y·nilai").
 *
 * Fungsi scriptable (borderColor/backgroundColor) menerima konteks Chart.js
 * saat render; tanpa chartArea (render perdana) dikembalikan warna polos
 * supaya tidak pernah melempar.
 */

export const HUD_COLORS = {
  cyan: "#22d3ee",
  violet: "#a78bfa",
  pointCore: "rgba(4,10,20,0.92)",
  pointEdge: "#67e8f9",
  gridX: "rgba(34,211,238,0.07)",
  glow: "rgba(34,211,238,0.50)", // nama "glow" dipilih agar tidak memicu utilitas bayangan Tailwind
};

/** Plugin glow neon: bayangan cyan di sekitar dataset garis/batang. */
export const hudGlowPlugin = {
  id: "hudGlow",
  beforeDatasetsDraw(chart) {
    const c = chart.ctx;
    c.save();
    c.shadowColor = HUD_COLORS.glow;
    c.shadowBlur = 14;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  },
};

/** '#rrggbb' + alpha(0..1) -> 'rgba(r,g,b,a)'. Input tak valid -> transparan. */
export function hudAlpha(hex, alpha) {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return `rgba(0,0,0,${a})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Fragmen gaya dataset garis berkarakter balanceTrend.
 * @param {object}  [o]
 * @param {string}  [o.from]     warna awal gradasi garis (bawaan cyan)
 * @param {string}  [o.to]       warna akhir gradasi (bawaan = from)
 * @param {string}  [o.fill]     warna dasar area (bawaan = from)
 * @param {number}  [o.points]   jumlah titik data (>12 -> crosshair mengecil)
 * @param {boolean} [o.gradient] false = garis solid (chart multi-seri, supaya
 *                               legenda & keterbacaan seri tetap jelas)
 */
export function hudLineDataset({ from = HUD_COLORS.cyan, to, fill, points = 6, gradient = true } = {}) {
  const end = typeof to === "string" ? to : from;
  const fillColor = typeof fill === "string" ? fill : from;
  const dense = Number.isFinite(points) && points > 12;
  return {
    borderColor: gradient
      ? (ctx) => {
          const a = ctx.chart.chartArea;
          if (!a) return from;
          const g = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0);
          g.addColorStop(0, from);
          g.addColorStop(1, end);
          return g;
        }
      : from,
    backgroundColor: (ctx) => {
      const a = ctx.chart.chartArea;
      if (!a) return hudAlpha(fillColor, 0.12);
      const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, hudAlpha(fillColor, 0.30));
      g.addColorStop(0.65, hudAlpha(fillColor, 0.10));
      g.addColorStop(1, hudAlpha(fillColor, 0));
      return g;
    },
    fill: true,
    tension: 0.45,
    borderWidth: 3,
    pointStyle: "crossRot",
    pointRadius: dense ? 3.5 : 6,
    pointHoverRadius: dense ? 6 : 9,
    pointBackgroundColor: HUD_COLORS.pointCore,
    pointBorderColor: HUD_COLORS.pointEdge,
    pointBorderWidth: 2,
  };
}

/**
 * Sumbu koordinat berkarakter balanceTrend: grid cyan tipis dua arah + tick
 * teknis ("T01·Agu" di X saat tidak padat, "Y·4.5M" di Y).
 * @param {string[]} labels   label X (dipakai tick T-kode)
 * @param {Function} formatShort pemformat angka Y (mis. formatShortVal)
 * @param {object}  [o]
 * @param {string}  [o.yGrid] warna grid Y (bawaan cyan redup; bisa chartGridColor())
 */
/** Warna glow ungu utk donut "reactor" (kontras dgn cyan milik grafik garis). */
export const HUD_GLOW_VIOLET = "rgba(167,139,250,0.45)";

/** Plugin glow violet utk donut -- dipasang per-chart via `plugins: [hudDonutGlowPlugin]`. */
export const hudDonutGlowPlugin = {
  id: "hudGlow",
  beforeDatasetsDraw(chart) {
    const c = chart.ctx;
    c.save();
    c.shadowColor = HUD_GLOW_VIOLET;
    c.shadowBlur = 16;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  }
};

/** Resolusi warna per batang: string, array per index, atau fn(i). */
function resolveHudColor(spec, i) {
  if (typeof spec === "function") return spec(i);
  if (Array.isArray(spec)) return spec[i] || spec[spec.length - 1] || "#22d3ee";
  return spec || "#22d3ee";
}

/**
 * DNA grafik batang HUD: gradasi vertikal neon (puncak terang -> dasar memudar),
 * casing neon tipis, ujung membulat. `from`/`to` boleh string, array per batang,
 * atau fn(i) -- utk batang dua warna (net +/-). Aman tanpa DOM: scriptable
 * callback fallback ke warna solid kalau ctx chart belum ada.
 */
export function hudBarDataset(opts = {}) {
  const {
    from = "#22d3ee",
    to = null, // default: sama dgn from (gradasi satu hue)
    borderRadius = 6,
    borderSkipped = false,
    // Default 0.92: jarak antar batang lebih rapat (permintaan pemilik) -- boleh dioverride.
    barPercentage = 0.92,
    categoryPercentage = 0.92,
    maxBarThickness
  } = opts;
  return {
    backgroundColor: (ctx) => {
      const base = resolveHudColor(from, ctx.dataIndex);
      const tip = to == null ? base : resolveHudColor(to, ctx.dataIndex);
      const chart = ctx.chart;
      if (!chart || !chart.ctx || !chart.ctx.createLinearGradient) return base;
      // PENTING: gradien dihitung dari AREA PLOT (chartArea), bukan element.y/base.
      // Pada resolve pertama, elemen bar masih di posisi awal animasi (y == base)
      // sehingga gradien berbasis geometri jatuh ke fallback solid dan gradasi baru
      // "muncul" setelah hover/klik me-resolve ulang opsi. chartArea/height sudah
      // stabil sejak render pertama -> gradasi langsung aktif tanpa interaksi.
      const area = chart.chartArea;
      const top = area ? area.top : 0;
      const bottom = area ? area.bottom : (chart.height || 300);
      if (!(bottom - top > 0.5)) return tip;
      const g = chart.ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, tip);
      g.addColorStop(1, hudAlpha(base, 0.32));
      return g;
    },
    borderColor: (ctx) => hudAlpha(resolveHudColor(to == null ? from : to, ctx.dataIndex), 0.9),
    borderWidth: 1,
    hoverBackgroundColor: (ctx) => resolveHudColor(to == null ? from : to, ctx.dataIndex),
    borderRadius,
    borderSkipped,
    barPercentage,
    categoryPercentage,
    ...(maxBarThickness != null ? { maxBarThickness } : {})
  };
}

/**
 * DNA segmen donut HUD: tiap segmen bergradasi sepanjang sudutnya (ujung terang
 * -> ekor memudar) seperti komet neon di ring reactor. `palette` = array warna
 * per segmen (palet aplikasi tetap sumber warna -- kontrak colorblind aman).
 */
export function hudDonutSegment(palette) {
  const list = Array.isArray(palette) && palette.length ? palette : ["#22d3ee"];
  return (ctx) => {
    const base = list[ctx.dataIndex % list.length];
    const chart = ctx.chart;
    if (!chart || !chart.ctx || !chart.ctx.createLinearGradient) return base;
    // PENTING: sudut komet dihitung dari DATA dataset (stabil di resolve pertama),
    // bukan element.startAngle/endAngle -- elemen arc belum ber-geometri final saat
    // render pertama sehingga gradasi dulunya baru muncul setelah diklik. Asumsi:
    // rotasi default Chart.js (mulai jam 12, searah jarum jam) -- semua donut app
    // ini memakai default. Fallback solid bila data kosong/rusak.
    const data = (ctx.dataset && ctx.dataset.data) || [];
    const vals = data.map((v) => Math.max(0, Number(v) || 0));
    const total = vals.reduce((a, v) => a + v, 0);
    const area = chart.chartArea;
    const cx = area ? (area.left + area.right) / 2 : (chart.width || 300) / 2;
    const cy = area ? (area.top + area.bottom) / 2 : (chart.height || 300) / 2;
    const r = Math.max(8, Math.min(chart.width || 300, chart.height || 300) / 2 - 4);
    let frac = 0;
    if (total > 0) { for (let i = 0; i < ctx.dataIndex; i++) frac += vals[i] / total; }
    const span = total > 0 ? (vals[ctx.dataIndex] || 0) / total : 1 / list.length;
    const a1 = -Math.PI / 2 + frac * 2 * Math.PI;
    const a2 = a1 + Math.max(span, 0.02) * 2 * Math.PI;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const x2 = cx + Math.cos(a2) * r;
    const y2 = cy + Math.sin(a2) * r;
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2) || (Math.abs(x2 - x1) < 0.01 && Math.abs(y2 - y1) < 0.01)) {
      return base;
    }
    const g = chart.ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, base);
    g.addColorStop(1, hudAlpha(base, 0.5));
    return g;
  };
}

export function hudLineScales(labels, formatShort, { yGrid } = {}) {
  const list = Array.isArray(labels) ? labels : [];
  const dense = list.length > 16;
  const fmt = typeof formatShort === "function" ? formatShort : (v) => String(v);
  return {
    x: {
      grid: { color: HUD_COLORS.gridX },
      ticks: {
        font: { size: 9, weight: "bold" },
        maxTicksLimit: 8,
        autoSkip: true,
        ...(dense ? {} : { callback: (v, i) => "T" + String(i + 1).padStart(2, "0") + "·" + list[i] }),
      },
    },
    y: {
      grid: { color: typeof yGrid === "string" ? yGrid : "rgba(34,211,238,0.10)" },
      ticks: { font: { size: 9 }, callback: (v) => "Y·" + fmt(v) },
    },
  };
}
