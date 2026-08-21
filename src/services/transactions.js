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
          .select("id, jenis, tanggal, jumlah, akun, kategori, keterangan, mata_uang, kurs, jumlah_idr")
          .order("tanggal", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      );

      return rows.map((row) => ({
        ...row,
        jumlah: Number(row.jumlah),
        jumlah_idr: row.jumlah_idr != null ? Number(row.jumlah_idr) : null,
      }));
    },

    async create(data) {
      const user_id = await getCurrentUserId(supabase);
      const { error } = await supabase.from("transactions").insert({
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
      });
      if (error) throw error;
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
          kurs: data.kurs || 1,
          jumlah_idr: data.jumlah_idr != null ? data.jumlah_idr : data.jumlah,
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
