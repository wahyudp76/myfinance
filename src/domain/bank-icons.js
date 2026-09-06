/**
 * src/domain/bank-icons.js — Database bank/e-wallet/asset + deteksi ikon otomatis.
 *
 * PILOT MIGRASI MONOLIT → MODUL (lanjutan setelah src/domain/asset-icons.js).
 * `bankWalletDatabase` (daftar logo bank/e-wallet/platform investasi, SELF-HOSTED di
 * `icons/banks/` atau badge huruf) dan `detectAutoAccountIcon(name)` sebelumnya HANYA
 * hidup di monolit app.src.js (global, tanpa unit test), padahal:
 *   - `detectAutoAccountIcon` dipakai saat render detail akun & saat menampilkan ikon
 *     otomatis untuk akun yang tidak punya ikon kustom.
 *   - `bankWalletDatabase` juga dipakai langsung oleh pencarian saran akun
 *     (`searchAccountModalSuggestions`) & saran platform aset
 *     (`searchAssetBankSuggestions`).
 *
 * Di sini dibuat satu rumah kanonik ter-tes: data + logika deteksi. Perilaku
 * dipertahankan byte-compatible dengan implementasi monolit yang berjalan di produksi
 * (lihat tests/unit/bank-icons-domain.test.js: guard konsistensi mengekstrak
 * implementasi DEFAULT __bankIcon dari app.src.js & menyamakan output).
 *
 * KONTRAK (jangan diubah tanpa mengubah test):
 * - bankWalletDatabase : array konstan {name, category, keywords[], url?|badge?, color?}.
 * - detectAutoAccountIcon(name) : null bila tak cocok; else {type, value, (color|alt)}
 *   dengan type = 'icon-plain' | 'image' | 'badge'. Kata kunci paling panjang menang.
 * - url lokal mengarah ke icons/banks/* atau icons/platforms/* (keduanya self-hosted,
 *   keduanya diizinkan ICON_ASSET_PATH_RE sejak v86).
 */

/** Daftar logo bank/e-wallet/platform investasi (SELF-HOSTED; tidak hotlink Wikimedia). */
export const bankWalletDatabase = [
  { name: "Bank Central Asia (BCA)", category: "Bank", keywords: ["bca", "central asia"], url: "icons/banks/bca.svg" },
  { name: "Bank Mandiri", category: "Bank", keywords: ["mandiri"], url: "icons/banks/mandiri.svg" },
  { name: "Bank Rakyat Indonesia (BRI)", category: "Bank", keywords: ["bri", "rakyat indonesia"], url: "icons/banks/bri.svg" },
  { name: "Bank Negara Indonesia (BNI)", category: "Bank", keywords: ["bni", "negara indonesia"], url: "icons/banks/bni.png" },
  { name: "Bank Syariah Indonesia (BSI)", category: "Bank", keywords: ["bsi", "syariah indonesia"], url: "icons/banks/bsi.svg" },
  { name: "Bank Jago", category: "Bank", keywords: ["jago", "bank jago"], url: "icons/banks/jago.svg" },
  { name: "GoPay", category: "E-Wallet", keywords: ["gopay", "go-pay"], url: "icons/banks/gopay.svg" },
  { name: "OVO", category: "E-Wallet", keywords: ["ovo"], url: "icons/banks/ovo.svg" },
  { name: "DANA", category: "E-Wallet", keywords: ["dana"], url: "icons/banks/dana.svg" },
  { name: "ShopeePay", category: "E-Wallet", keywords: ["shopeepay", "shopee pay"], url: "icons/banks/shopeepay.svg" },
  // Tambahan untuk Platform Aset/Investasi (Bisa jadi akun juga).
  // v86: logo SELF-HOSTED kembali dipakai (icons/platforms/*) -- badge huruf hanya
  // utk platform yang memang belum punya file lokal (IPOT). Ikon self-hosted =
  // nol dependensi pihak ketiga, lolos CSP 'self', tetap tampil offline, dan
  // (sejak v86 juga) lolos sanitizeIconOverride karena ICON_ASSET_PATH_RE kini
  // mengizinkan folder icons/platforms/. Logo platform LAIN yang disimpan admin
  // di tabel Supabase platform_logos tetap MENIMPA nilai lokal saat load (lihat
  // penjelasan di AGENT-HANDOFF v86).
  { name: "Bibit", category: "Investasi", keywords: ["bibit", "reksa dana bibit"], url: "icons/platforms/bibit.svg" },
  { name: "Ajaib", category: "Investasi", keywords: ["ajaib"], url: "icons/platforms/ajaib.ico" },
  { name: "Stockbit", category: "Investasi", keywords: ["stockbit"], url: "icons/platforms/stockbit.svg" },
  { name: "Bareksa", category: "Investasi", keywords: ["bareksa"], url: "icons/platforms/bareksa.svg" },
  { name: "Pluang", category: "Investasi", keywords: ["pluang"], url: "icons/platforms/pluang.png" },
  { name: "Indodax", category: "Investasi", keywords: ["indodax", "kripto"], url: "icons/platforms/indodax.png" },
  { name: "Tokocrypto", category: "Investasi", keywords: ["tokocrypto", "kripto"], url: "icons/platforms/tokocrypto.svg" },
  { name: "Pintu", category: "Investasi", keywords: ["pintu", "kripto pintu"], url: "icons/platforms/pintu.png" },
  { name: "IPOT", category: "Investasi", keywords: ["ipot", "indopremier"], badge: "IP", color: "bg-indigo-600" },
  { name: "Mirae", category: "Investasi", keywords: ["mirae", "hots"], url: "icons/platforms/mirae.svg" },
  { name: "GoTo", category: "Investasi", keywords: ["goto", "goto group"], url: "icons/platforms/goto.svg" },
  { name: "Danamas Stabil", category: "Investasi", keywords: ["danamas", "danamas stabil"], url: "icons/platforms/danamas-stabil.png" },
];

/** Mendeteksi logo otomatis dari database bank/e-wallet berdasarkan nama akun. */
export function detectAutoAccountIcon(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("tunai") || n.includes("cash")) return { type: "icon-plain", value: "fa-money-bill-wave", color: "text-emerald-500" };
  if (n.includes("investasi") || n.includes("saham") || n.includes("reksadana")) return { type: "icon-plain", value: "fa-chart-line", color: "text-purple-600" };
  let match = null, bestLen = 0;
  bankWalletDatabase.forEach((item) => {
    item.keywords.forEach((kw) => { if (n.includes(kw) && kw.length > bestLen) { match = item; bestLen = kw.length; } });
  });
  if (match) {
    if (match.url) return { type: "image", value: match.url, alt: name };
    if (match.badge) return { type: "badge", value: match.badge, color: match.color };
  }
  return null;
}

/** Objek DI (default-injection) yang dipakai monolit untuk meng-adopt ke modul ter-tes. */
export function bankIconCtx() {
  return { detectAutoAccountIcon, bankWalletDatabase };
}
