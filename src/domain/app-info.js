/**
 * Pure helpers untuk kartu "Tentang Aplikasi & Penyimpanan" di tab Pengaturan.
 * Tidak menyentuh DOM/network -- penghitungan & format di sini, pengambilan
 * data (caches.keys, navigator.storage.estimate) tetap di index.html.
 */

/**
 * Ringkasan jumlah data user utk ditampilkan di Pengaturan.
 * `categories` boleh angka (sudah dihitung pemanggil) atau object dict kategori.
 */
export function summarizeAppData({ transactions = [], accounts = [], categories = 0, assets = [], recurring = [] } = {}) {
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  const cats = typeof categories === "number"
    ? categories
    : (categories && typeof categories === "object" ? Object.keys(categories).length : 0);
  return {
    transactions: len(transactions),
    accounts: len(accounts),
    categories: cats,
    assets: len(assets),
    recurring: len(recurring),
  };
}

/** Format byte -> satuan manusia (id-ID style, titik desimal). 0 B utk 0/negatif kecil. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${String(rounded).replace(".", ",")} ${units[i]}`;
}
