/**
 * Paging paralel BERSAMA untuk semua service Supabase (v56).
 *
 * Riwayat: pola fetch-all-rows mula-mula lahir di src/services/transactions.js
 * sebagai loop BERURUTAN, di-upgrade jadi 2-fase paralel di v55, lalu
 * disalin-lokal (masih berurutan) ke assets.js & recurring.js. v56 melebur
 * ketiganya jadi SATU modul ini supaya perilaku paging (batas paralel, fallback,
 * urutan hasil, propagasi error) identik di semua tabel -- tidak ada salinan
 * yang bisa diam-diam tertinggal di versi lama.
 *
 * Kontrak buildQuery(from, to, opts): fungsi pembangun query yang MENGEMBALIKAN builder
 * PostgREST yang sudah .range(from, to) dan bisa langsung di-await (thenable).
 * Client Supabase di-close-over oleh pemanggil. Opsi `{ withCount: true }` pada
 * halaman pertama meminta builder menambahkan `{ count: "exact" }` di .select()
 * -- satu-satunya cara mengetahui total baris tanpa request terpisah.
 *
 * Dua fase:
 *   1. Halaman pertama + COUNT total dalam satu request (Prefer: count=exact,
 *      header yang sama dengan query biasa -- overhead dapat diabaikan).
 *   2. Bila total diketahui & masih ada halaman lain -> sisanya di-fetch
 *      PARALEL dalam batch (MAX_PARALLEL_PAGES). Bila count tidak tersedia
 *      (mock/proxy yang memotong header Content-Range) -> fallback loop
 *      berurutan, persis perilaku pra-v55.
 *
 * Urutan hasil = gabungan halaman berurutan (tiap halaman sudah terurut oleh
 * query), jadi IDENTIK dengan hasil fetch berurutan. Error di halaman mana pun
 * DILEMPAR (tidak pernah diam-diam memotong data).
 */

const DEFAULT_PAGE_SIZE = 1000;

// Batas request PARALEL per pemanggilan -- sopan terhadap PostgREST
// dan tabel api_rate_limits (lihat sql/migration_rate_limiting_2026-08.sql),
// tapi tetap berlipat lebih cepat daripada berurutan untuk akun besar.
const MAX_PARALLEL_PAGES = 6;

export async function fetchAllRows(supabase, buildQuery, pageSize = DEFAULT_PAGE_SIZE) {
  const first = await buildQuery(0, pageSize - 1, { withCount: true });
  if (first.error) throw first.error;
  const firstRows = first.data ?? [];
  if (!firstRows.length || firstRows.length < pageSize) return firstRows;

  const data = [firstRows];
  const total = first.count;
  if (typeof total === "number") {
    const pageCount = Math.ceil(total / pageSize);
    for (let p = 1; p < pageCount; p += MAX_PARALLEL_PAGES) {
      const batch = [];
      for (let q = p; q < Math.min(p + MAX_PARALLEL_PAGES, pageCount); q += 1) {
        batch.push(buildQuery(q * pageSize, q * pageSize + pageSize - 1, { withCount: false }));
      }
      const results = await Promise.all(batch);
      results.forEach((r) => {
        if (r.error) throw r.error;
        data.push(r.data ?? []);
      });
    }
  } else {
    for (let from = pageSize; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data: page, error } = await buildQuery(from, to, { withCount: false });
      if (error) throw error;
      if (!page?.length) break;
      data.push(page);
      if (page.length < pageSize) break;
    }
  }
  return data.flat();
}
