/**
 * Pure theme-color domain helpers (fitur "Warna Aksen"). No DOM, Supabase,
 * localStorage, or network access -- semua warna dihitung di sini supaya bisa
 * diuji unit tanpa browser.
 *
 * Cara kerja singkat: satu warna dasar (hex) dipakai untuk MENGHASILKAN ramp
 * shade 50..700 (dengan mencampur ke putih/hitam), lalu index.html memasang
 * hasilnya sebagai CSS variables (--accent-50 .. --accent-700) pada
 * <html> dan menandai <body data-theme-accent="...">. styles.css berisi
 * override BERYANGKUT SELERA utk kelas utilitas emerald yang dipakai app --
 * kalau atributnya tidak ada (themeColor null = bawaan), TIDAK ada satu pun
 * rule yang aktif, jadi tampilan default identik byte-demi-byte.
 */

/** Pilihan warna siap pakai di UI Pengaturan. `emerald` = bawaan (urutan pertawah). */
export const PRESET_THEMES = [
  { id: "emerald", label: "Zamrud (bawaan)", color: "#10b981" },
  { id: "biru", label: "Biru", color: "#3b82f6" },
  { id: "indigo", label: "Indigo", color: "#6366f1" },
  { id: "ungu", label: "Ungu", color: "#8b5cf6" },
  { id: "sky", label: "Sky", color: "#0ea5e9" },
  { id: "teal", label: "Teal", color: "#14b8a6" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
];

/**
 * Normalisasi input warna jadi '#rrggbb' lowercase, atau null kalau tidak
 * valid. Menerima '#abc' (singkat), '#aabbcc', 'aabbcc' (tanpa #), dan
 * menolak semua lainnya -- termasuk input non-string (mis. angka/object dari
 * settings cloud yang corrupt).
 * @returns {string|null}
 */
export function normalizeThemeColor(value) {
  if (typeof value !== "string") return null;
  let v = value.trim().toLowerCase();
  if (!v) return null;
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  if (!/^#[0-9a-f]{6}$/.test(v)) return null;
  return v;
}

/** '#rrggbb' -> {r,g,b} (0-255). Input HARUS sudah lolos normalizeThemeColor. */
export function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

/** Campur warna a -> b sebesar amount (0 = murni a, 1 = murni b). */
function mix(a, b, amount) {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  };
}

/**
 * Warna teks yang kontras di atas warna dasar (YIQ luminance) -- dipakai utk
 * teks di tombol berlatar aksen penuh (bg-emerald-500 + text-white), supaya
 * warna terang seperti amber tetap terbaca.
 */
export function contrastText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 168 ? "#0f172a" : "#ffffff";
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * Bangun ramp shade dari satu warna dasar. Kunci yang dikembalikan PERSIS
 * mengikuti kelas Tailwind emerald yang dipakai app (50,100,300,400,500,600,700)
 * plus helper gelap:
 * - `contrastText`  : warna teks di atas aksen penuh
 * - `darkChipRgba`  : latar chip semi-transparan utk mode gelap (pengganti
 *                     rgba(16,185,129,0.16) hardcoded di styles.css)
 * - `faint10Rgba`   : pengganti kelas bg-emerald-400/10
 * - `shade50Alpha60Rgba` : pengganti kelas bg-emerald-50/60
 * @returns {object|null} null kalau input tidak valid.
 */
export function buildAccentShades(hex) {
  const base = normalizeThemeColor(hex);
  if (!base) return null;
  const rgb = hexToRgb(base);
  const shades = {
    "50": toHex(mix(rgb, WHITE, 0.93)),
    "100": toHex(mix(rgb, WHITE, 0.85)),
    "300": toHex(mix(rgb, WHITE, 0.55)),
    "400": toHex(mix(rgb, WHITE, 0.28)),
    "500": base,
    "600": toHex(mix(rgb, BLACK, 0.13)),
    "700": toHex(mix(rgb, BLACK, 0.26)),
  };
  const s50 = hexToRgb(shades["50"]);
  shades.contrastText = contrastText(base);
  shades.darkChipRgba = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`;
  shades.faint10Rgba = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`;
  shades.shade50Alpha60Rgba = `rgba(${s50.r}, ${s50.g}, ${s50.b}, 0.6)`;
  return shades;
}
