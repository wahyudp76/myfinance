/**
 * src/domain/category-style.js — Resolusi gaya & parent kategori (pure helpers).
 *
 * PILOT MIGRASI MONOLIT → MODUL (lanjutan format.js & dates.js).
 *
 * Logika keputusan "kategori ini anak dari siapa / bergaya bagaimana" murni
 * bergantung pada dua lookup yang dibuat monolit dari state-nya:
 *   - `categoryDict` (pengeluaran/pemasukan -> { icon, bg, color, subs })
 *   - `subCategoryLookup` (nama sub -> { parentName, icon, bg, color, type })
 * Modul di bawah menerima lookups sbg parameter (pure), sehingga bisa diuji
 * unit tanpa DOM/state. Monolit men-delegasi dengan memasukkan state miliknya.
 *
 * KONTRAK (byte-compatible dgn resolveBaseCategoryStyle monolit, lihat
 * tests/unit/category-style.test.js): return { icon, bg, color, parent, parentName }.
 */

/** Resolusi gaya BAWAAN (tanpa override kustom user) — murni dari lookups. */
export function resolveBaseCategoryStyle({ categoryDict, subCategoryLookup, catName, jenis }) {
  if (jenis === "Transfer") {
    return { icon: "fa-exchange-alt", bg: "bg-blue-100", color: "text-blue-500", parent: "Transfer", parentName: "Transfer" };
  }
  const found = subCategoryLookup ? subCategoryLookup[catName] : undefined;
  if (found) return found;
  if (jenis === "Pengeluaran" && categoryDict && categoryDict.pengeluaran && categoryDict.pengeluaran[catName]) {
    const p = categoryDict.pengeluaran[catName];
    return { icon: p.icon, bg: p.bg, color: p.color, parent: catName, parentName: catName };
  }
  if (jenis === "Pemasukan" && categoryDict && categoryDict.pemasukan && categoryDict.pemasukan[catName]) {
    const p = categoryDict.pemasukan[catName];
    return { icon: p.icon, bg: p.bg, color: p.color, parent: catName, parentName: catName };
  }
  if (jenis === "Pemasukan") return { icon: "fa-arrow-down", bg: "bg-emerald-100", color: "text-emerald-500", parent: "Lain-lain", parentName: "Lain-lain" };
  return { icon: "fa-arrow-up", bg: "bg-rose-100", color: "text-rose-500", parent: "Lain-lain", parentName: "Lain-lain" };
}

/**
 * Nama parent sebuah kategori (parentName dari gaya base) — yang dipakai modul
 * ter-tes (reports/insights) sebagai DI `categorizeParent(kategori, jenis)`.
 * Murni dari lookups; return undefined bila pada dasarnya kategori itu drop-in
 * (agar konsumen bisa fallback ke nama asli, sperti monolit).
 */
export function categorizeParentFromLookup({ categoryDict, subCategoryLookup, catName, jenis }) {
  return resolveBaseCategoryStyle({ categoryDict, subCategoryLookup, catName, jenis }).parentName;
}

/** Objek convenience (pola sama dgn formatCtx/dateCtx). */
export function categoryStyleCtx() {
  return { resolveBaseCategoryStyle, categorizeParentFromLookup };
}
