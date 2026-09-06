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
  // Tambahan untuk Platform Aset/Investasi (Bisa jadi akun juga)
  { name: "Bibit", category: "Investasi", keywords: ["bibit", "reksa dana bibit"], badge: "BB", color: "bg-green-600" },
  { name: "Ajaib", category: "Investasi", keywords: ["ajaib"], badge: "AJ", color: "bg-blue-500" },
  { name: "Stockbit", category: "Investasi", keywords: ["stockbit"], badge: "SB", color: "bg-emerald-500" },
  { name: "Bareksa", category: "Investasi", keywords: ["bareksa"], badge: "BR", color: "bg-teal-600" },
  { name: "Pluang", category: "Investasi", keywords: ["pluang"], badge: "PL", color: "bg-slate-800" },
  { name: "Indodax", category: "Investasi", keywords: ["indodax", "kripto"], badge: "ID", color: "bg-blue-600" },
  { name: "Tokocrypto", category: "Investasi", keywords: ["tokocrypto", "kripto"], badge: "TC", color: "bg-blue-400" },
  { name: "Pintu", category: "Investasi", keywords: ["pintu", "kripto pintu"], badge: "PT", color: "bg-slate-900" },
  { name: "IPOT", category: "Investasi", keywords: ["ipot", "indopremier"], badge: "IP", color: "bg-indigo-600" },
  { name: "Mirae", category: "Investasi", keywords: ["mirae", "hots"], badge: "MR", color: "bg-orange-500" },
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
