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
