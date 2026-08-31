/**
 * Palet warna grafik proporsi (Tier-3 #11: data-viz polish).
 *
 * Dua palet:
 * - "default": palet estetik lama (indigo->violet->cyan->...), dipertahankan
 *   sebagai bawaan supaya tidak ada perubahan visual bagi pengguna lama.
 * - "colorblind": Okabe-Ito (biru/oranye/hijau) -- aman untuk deuteranopia &
 *   protanopia (merah-hijau), palet ilmiah paling umum dipakai jurnal data-viz.
 *
 * Murni tanpa DOM/Chart -- dipakai ui/categories.js (fallback), wrapper
 * index.html (meneruskan pilihan appSettings.chartPalette), dan unit test.
 */

export const CHART_PALETTES = {
  default: {
    label: "Standar",
    colors: [
      "#22d3ee", "#f472b6", "#a78bfa", "#60a5fa", "#34d399",
      "#fbbf24", "#fb7185", "#38bdf8", "#e879f9", "#94a3b8",
    ],
  },
  colorblind: {
    label: "Ramah Buta Warna",
    colors: [
      "#0173B2", "#DE8F05", "#029E73", "#D55E00", "#CC78BC",
      "#CA9161", "#FBAFE4", "#56B4E9", "#7E7E7E", "#B07AA1",
    ],
  },
};

/** Kembalikan array warna palet; nama tak dikenal -> palet default. */
export function pickChartPalette(name) {
  const p = CHART_PALETTES[name];
  return (p && Array.isArray(p.colors) && p.colors.length) ? p.colors : CHART_PALETTES.default.colors;
}

/** Label ramah utk toast/pengaturan; nama tak dikenal -> label default. */
export function chartPaletteLabel(name) {
  const p = CHART_PALETTES[name];
  return p ? p.label : CHART_PALETTES.default.label;
}
