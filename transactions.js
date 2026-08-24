const DEFAULT_PAGE_SIZE = 1000;

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

async function getCurrentUserId(client) {
  const { data, error } = await requireClient(client).auth.getUser();
  if (error || !data.user) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  return data.user.id;
}

async function fetchAllRows(client, buildQuery, pageSize = DEFAULT_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export function createTransactionService(client) {
  const supabase = requireClient(client);

  return {
    async list() {
      const rows = await fetchAllRows(
        supabase,
        (from, to) => supabase
          .from("transactions")
          .select("id, jenis, tanggal, jumlah, akun, kategori, keterangan, mata_uang, kurs, jumlah_idr, transfer_jumlah_tujuan, transfer_mata_uang_tujuan, transfer_kurs_tujuan, transfer_jumlah_tujuan_idr")
          .order("tanggal", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      );

      return rows.map((row) => ({
        ...row,
        jumlah: Number(row.jumlah),
        jumlah_idr: row.jumlah_idr != null ? Number(row.jumlah_idr) : null,
        // Sisi TUJUAN transfer lintas mata uang -- null utk transaksi non-Transfer & transfer
        // historis dari sebelum fitur ini ada.
        transfer_jumlah_tujuan: row.transfer_jumlah_tujuan != null ? Number(row.transfer_jumlah_tujuan) : null,
        transfer_kurs_tujuan: row.transfer_kurs_tujuan != null ? Number(row.transfer_kurs_tujuan) : null,
        transfer_jumlah_tujuan_idr: row.transfer_jumlah_tujuan_idr != null ? Number(row.transfer_jumlah_tujuan_idr) : null,
      }));
    },

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
          kurs: data.kurs || null,
          jumlah_idr: data.jumlah_idr != null ? data.jumlah_idr : data.jumlah,
        })
        .select("id")
        .single();
      if (error) throw error;
      return inserted;
    },

    async update(id, data) {
      const user_id = await getCurrentUserId(supabase);
      const { error } = await supabase
        .from("transactions")
        .update({
          jenis: data.jenis,
          tanggal: data.tanggal,
          jumlah: data.jumlah,
          akun: data.akun,
          kategori: data.kategori,
          keterangan: data.keterangan,
          mata_uang: data.mata_uang || null,
          kurs: data.kurs || null,
          jumlah_idr: data.jumlah_idr != null ? data.jumlah_idr : data.jumlah,
          // Sisi TUJUAN transfer -- cuma relevan saat edit transaksi jenis Transfer (lihat
          // index.html submitForm()); untuk tipe lain nilainya undefined di `data`, yang berarti
          // kolom ini di-set null -- memang seharusnya null utk transaksi non-Transfer.
          transfer_jumlah_tujuan: data.transfer_jumlah_tujuan != null ? Number(data.transfer_jumlah_tujuan) : null,
          transfer_mata_uang_tujuan: data.transfer_mata_uang_tujuan || null,
          transfer_kurs_tujuan: data.transfer_kurs_tujuan != null ? Number(data.transfer_kurs_tujuan) : null,
          transfer_jumlah_tujuan_idr: data.transfer_jumlah_tujuan_idr != null ? Number(data.transfer_jumlah_tujuan_idr) : null,
        })
        .eq("id", id)
        .eq("user_id", user_id);
      if (error) throw error;
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
