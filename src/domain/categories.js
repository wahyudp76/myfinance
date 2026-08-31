/**
 * MyFinance category-detail domain logic (resolusi parent+sub kategori &
 * ringkasan bulanan/harian untuk halaman Kategori Detail).
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted dari openCategoryDetail() dan renderCategoryDetailMonthData()
 * di index.html (lanjutan Phase 4/7 -- "Break the monolithic client into
 * modules by domain", lihat docs/architecture-modernization-plan.md).
 * Perilaku dipertahankan 100% sama seperti kode lama -- ini pemindahan,
 * bukan penulisan ulang.
 *
 * parseTgl/txIdrAmount SENGAJA disuntik lewat parameter, bukan
 * diduplikasi -- supaya index.html tetap satu-satunya sumber kebenaran
 * untuk fungsi-fungsi itu (pola yang sama dengan modul domain lain).
 */

/**
 * Nama kategori yang perlu ikut dihitung saat membuka Kategori Detail:
 * `categoryName` itu sendiri, DITAMBAH semua nama sub-kategorinya kalau
 * dia ternyata sebuah PARENT (bukan sub atau kategori tanpa sub).
 * Extracted dari openCategoryDetail().
 *
 * @param {Record<string, Record<string, {subs?: Array<{name: string}>}>>} categoryDict -
 *   { pemasukan: {...}, pengeluaran: {...} } -- kunci jenis huruf kecil.
 * @param {string} categoryName
 * @param {string} jenis - "Pemasukan" | "Pengeluaran" (dicocokkan case-insensitive ke categoryDict).
 * @returns {string[]} - [categoryName] kalau bukan parent/tidak ditemukan, atau
 *   [categoryName, ...namaSub] kalau parent.
 */
export function resolveCategoryAndSubNames(categoryDict, categoryName, jenis) {
  let names = [categoryName];
  const jenisDict = categoryDict && categoryDict[jenis.toLowerCase()];
  if (jenisDict && jenisDict[categoryName]) {
    names = names.concat(jenisDict[categoryName].subs.map((s) => s.name));
  }
  return names;
}

/**
 * Total & tren harian (utk chart bar) transaksi 1 kategori (+sub-nya) pada
 * SATU bulan tertentu. Extracted dari renderCategoryDetailMonthData().
 *
 * CATATAN: `dailyLabels` diisi utk SEMUA hari di bulan itu (1..akhir bulan),
 * bukan cuma hari yang ada transaksinya -- persis kode asli, supaya chart
 * bar-nya selalu punya batang kosong (0) di hari tanpa transaksi.
 *
 * @param {Array<object>} specificData - transaksi 1 kategori(+sub), SEMUA waktu
 *   (dari resolveCategoryAndSubNames() + filter jenis, belum difilter bulan).
 * @param {number} year
 * @param {number} month - 1-12.
 * @param {object} deps
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount
 * @returns {{ totalMonth: number, dailyLabels: string[], dailyData: number[] }}
 */
export function computeCategoryDetailMonthChart(specificData, year, month, { parseTgl, txIdrAmount }) {
  const specificDataMonth = (specificData || []).filter((d) => {
    if (!d.tanggal) return false;
    const dDate = parseTgl(d.tanggal);
    return dDate.getFullYear() === year && (dDate.getMonth() + 1) === month;
  });

  const totalMonth = specificDataMonth.reduce((sum, d) => sum + txIdrAmount(d), 0);

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyMap = {};
  for (let i = 1; i <= daysInMonth; i++) dailyMap[i] = 0;
  specificDataMonth.forEach((row) => {
    const day = parseTgl(row.tanggal).getDate();
    dailyMap[day] += txIdrAmount(row);
  });

  return {
    totalMonth,
    dailyLabels: Object.keys(dailyMap),
    dailyData: Object.values(dailyMap),
  };
}

/**
 * Proporsi per sub-kategori (slice proporsi sub): agregasi transaksi 1
 * kategori (+sub-nya) pada SATU bulan, dikelompokkan per nama kategori
 * transaksi (transaksi menyimpan nama SUB di field `kategori` -- lihat
 * resolveCategoryAndSubNames). Dipakai chart donat + bar proporsi di
 * halaman Kategori Detail (src/ui/categories.js renderCategorySubProportion).
 *
 * @param {Array<object>} specificData - transaksi 1 kategori(+sub), SEMUA waktu.
 * @param {number} year
 * @param {number} month - 1-12.
 * @param {object} deps
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount - nilai IDR-equivalent (multi-currency).
 * @returns {{ items: Array<{name: string, total: number, count: number, pct: number}>, totalMonth: number }}
 *   items terurut total menurun; pct dibulatkan 1 desain (0-100).
 */
export function aggregateSubCategoryShares(specificData, year, month, { parseTgl, txIdrAmount }) {
  const rows = (specificData || []).filter((d) => {
    if (!d.tanggal) return false;
    const dDate = parseTgl(d.tanggal);
    return dDate.getFullYear() === year && (dDate.getMonth() + 1) === month;
  });

  const byName = new Map();
  rows.forEach((r) => {
    const name = r.kategori || "(tanpa kategori)";
    const cur = byName.get(name) || { name, total: 0, count: 0 };
    cur.total += txIdrAmount(r);
    cur.count += 1;
    byName.set(name, cur);
  });

  const totalMonth = rows.reduce((sum, d) => sum + txIdrAmount(d), 0);
  const items = Array.from(byName.values())
    .sort((a, b) => b.total - a.total)
    .map((it) => ({
      ...it,
      pct: totalMonth > 0 ? Math.round((it.total / totalMonth) * 1000) / 10 : 0,
    }));

  return { items, totalMonth };
}
