import { getCurrentUserId } from "./user-id.js";

const DEFAULT_PAGE_SIZE = 1000;

// Kolom transaksi yang dipilih -- dipakai list() DAN hasil create()/update(),
// supaya baris yang dikembalikan punya bentuk kanonik yang SAMA. Hasil
// create()/update() ini dipakai index.html untuk "echo lokal pasca-simpan"
// (tidak perlu menarik ulang seluruh tabel transaksi setelah setiap simpan).
const TX_SELECT =
  "id, jenis, tanggal, jumlah, akun, kategori, keterangan, mata_uang, kurs, jumlah_idr, transfer_jumlah_tujuan, transfer_mata_uang_tujuan, transfer_kurs_tujuan, transfer_jumlah_tujuan_idr";

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

/**
 * Pemetaan baris mentah PostgREST -> baris kanonik aplikasi (koersi Number pada
 * kolom nominal; null dipertahankan null). Satu-satunya sumber kebenaran bentuk
 * baris transaksi di sisi service -- dipakai list(), create(), dan update().
 */
export function mapTransactionRow(row) {
  if (!row) return null;
  return {
    ...row,
    jumlah: Number(row.jumlah),
    jumlah_idr: row.jumlah_idr != null ? Number(row.jumlah_idr) : null,
    // Sisi TUJUAN transfer lintas mata uang -- null utk transaksi non-Transfer &
    // transfer historis dari sebelum fitur ini ada.
    transfer_jumlah_tujuan: row.transfer_jumlah_tujuan != null ? Number(row.transfer_jumlah_tujuan) : null,
    transfer_kurs_tujuan: row.transfer_kurs_tujuan != null ? Number(row.transfer_kurs_tujuan) : null,
    transfer_jumlah_tujuan_idr: row.transfer_jumlah_tujuan_idr != null ? Number(row.transfer_jumlah_tujuan_idr) : null,
  };
}

// Batas request PARALEL per pemanggilan list() -- sopan terhadap PostgREST
// dan tabel api_rate_limits (lihat sql/migration_rate_limiting_2026-08.sql),
// tapi tetap berlipat lebih cepat daripada berurutan untuk akun besar.
const MAX_PARALLEL_PAGES = 6;

/**
 * Ambil SEMUA baris dengan paging. Dulu: N halaman BERURUTAN (N RTT).
 * Sekarang dua fase:
 *   1. Halaman pertama + COUNT total dalam satu request (Prefer: count=exact,
 *      header yang sama dengan query biasa -- overhead dapat diabaikan).
 *   2. Bila total diketahui & masih ada halaman lain -> sisanya di-fetch
 *      PARALEL dalam batch (MAX_PARALLEL_PAGES). Bila count tidak tersedia
 *      (mock/proxy yang memotong header Content-Range) -> fallback loop
 *      berurutan, persis perilaku lama.
 * Urutan hasil = gabungan halaman berurutan (tiap halaman sudah terurut oleh
 * query), jadi IDENTIK dengan hasil fetch berurutan.
 */
async function fetchAllRows(supabase, buildQuery, pageSize = DEFAULT_PAGE_SIZE) {
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

export function createTransactionService(client) {
  const supabase = requireClient(client);

  return {
    async list() {
      const rows = await fetchAllRows(
        supabase,
        (from, to, opts) => {
          const q = supabase
            .from("transactions")
            .select(TX_SELECT, opts && opts.withCount ? { count: "exact" } : undefined)
            .order("tanggal", { ascending: false })
            .order("id", { ascending: true });
          return q.range(from, to);
        }
      );

      return rows.map(mapTransactionRow);
    },

    // MENGEMBALIKAN baris yang baru disimpan (select().single() -- tetap 1
    // request yang sama dengan insert), supaya pemanggil bisa update state lokal
    // tanpa fetch ulang seluruh tabel. Bentuk baris = mapTransactionRow, sama
    // persis dengan list().
    async create(data) {
      const user_id = await getCurrentUserId(supabase);
      const { data: inserted, error } = await supabase
        .from("transactions")
        .insert({
          user_id,
          jenis: data.jenis,
          tanggal: data.tanggal,
          jumlah: data.jumlah,
          akun: data.akun,
          kategori: data.kategori,
          keterangan: data.keterangan,
          mata_uang: data.mata_uang || null,
          kurs: data.kurs || 1,
          jumlah_idr: data.jumlah_idr != null ? data.jumlah_idr : data.jumlah,
        })
        .select(TX_SELECT)
        .single();
      if (error) throw error;
      return mapTransactionRow(inserted);
    },

    // MENGEMBALIKAN baris hasil update, atau null kalau barisnya tidak ketemu
    // (mis. sudah dihapus di perangkat lain -- pemanggil boleh fallback ke
    // refresh penuh). maybeSingle() supaya 0 baris tidak dilempar sebagai error
    // (perilaku update() lama: tidak error kalau 0 baris terpengaruh).
    async update(id, data) {
      const user_id = await getCurrentUserId(supabase);
      const { data: updated, error } = await supabase
        .from("transactions")
        .update({
          jenis: data.jenis,
          tanggal: data.tanggal,
          jumlah: data.jumlah,
          akun: data.akun,
          kategori: data.kategori,
          keterangan: data.keterangan,
          mata_uang: data.mata_uang || null,
          kurs: data.kurs || 1,
          jumlah_idr: data.jumlah_idr != null ? data.jumlah_idr : data.jumlah,
          // Sisi TUJUAN transfer -- cuma relevan saat edit transaksi jenis Transfer; untuk tipe
          // lain nilainya undefined di `data`, artinya kolom ini di-set null (memang seharusnya
          // null utk transaksi non-Transfer).
          transfer_jumlah_tujuan: data.transfer_jumlah_tujuan != null ? Number(data.transfer_jumlah_tujuan) : null,
          transfer_mata_uang_tujuan: data.transfer_mata_uang_tujuan || null,
          transfer_kurs_tujuan: data.transfer_kurs_tujuan != null ? Number(data.transfer_kurs_tujuan) : null,
          transfer_jumlah_tujuan_idr: data.transfer_jumlah_tujuan_idr != null ? Number(data.transfer_jumlah_tujuan_idr) : null,
        })
        .eq("id", id)
        .eq("user_id", user_id)
        .select(TX_SELECT)
        .maybeSingle();
      if (error) throw error;
      return mapTransactionRow(updated);
    },

    async remove(id) {
      const user_id = await getCurrentUserId(supabase);
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id)
        .eq("user_id", user_id);
      if (error) throw error;
    },
  };
}

/**
 * Normalisasi data form transaksi -> payload INSERT (kolom tabel transactions).
 * Dulunya body addTransactionRemote() di adapter `api` (index.html) -- dipindah
 * ke sini saat pensyahan api.run (slice transactions) supaya pemanggilan service
 * langsung tetap punya SATU sumber kebenaran koersi yang sama: jumlah selalu
 * Number (form mengirim string), keterangan/mata_uang kosong jadi null, kurs
 * kosong jadi null (service create meneruskan apa adanya; default || 1 di
 * service hanya berlaku utk nilai falsy yang lolos), dan jumlah_idr fallback
 * ke jumlah saat tidak ada konversi mata uang.
 */
export function toCreateRecord(data) {
  return {
    jenis: data.jenis,
    tanggal: data.tanggal,
    jumlah: Number(data.jumlah),
    akun: data.akun,
    kategori: data.kategori,
    keterangan: data.keterangan || null,
    mata_uang: data.mata_uang || null,
    kurs: data.kurs || null,
    jumlah_idr: data.jumlah_idr != null ? Number(data.jumlah_idr) : Number(data.jumlah),
  };
}

/**
 * Normalisasi data form transaksi -> payload UPDATE. Sama dengan toCreateRecord
 * plus 4 kolom sisi TUJUAN transfer -- undefined di `data` berarti kolom di-set
 * null (memang seharusnya null utk transaksi non-Transfer). Dulunya body
 * editTransactionRemote() di adapter `api` (index.html).
 */
export function toUpdateRecord(data) {
  return {
    jenis: data.jenis,
    tanggal: data.tanggal,
    jumlah: Number(data.jumlah),
    akun: data.akun,
    kategori: data.kategori,
    keterangan: data.keterangan || null,
    mata_uang: data.mata_uang || null,
    kurs: data.kurs || null,
    jumlah_idr: data.jumlah_idr != null ? Number(data.jumlah_idr) : Number(data.jumlah),
    transfer_jumlah_tujuan: data.transfer_jumlah_tujuan != null ? Number(data.transfer_jumlah_tujuan) : null,
    transfer_mata_uang_tujuan: data.transfer_mata_uang_tujuan || null,
    transfer_kurs_tujuan: data.transfer_kurs_tujuan != null ? Number(data.transfer_kurs_tujuan) : null,
    transfer_jumlah_tujuan_idr: data.transfer_jumlah_tujuan_idr != null ? Number(data.transfer_jumlah_tujuan_idr) : null,
  };
}
