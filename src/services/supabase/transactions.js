/**
 * Supabase transaction service boundary.
 *
 * UI code should depend on this module instead of calling Supabase directly.
 * It intentionally contains no DOM/localStorage concerns.
 */

function requireClient(client) {
  if (!client || typeof client.from !== "function") {
    throw new Error("Supabase client tidak tersedia.");
  }
  return client;
}

function normalizeTransaction(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Data transaksi tidak valid.");
  }

  const jenis = input.jenis;
  if (!["Pemasukan", "Pengeluaran", "Transfer"].includes(jenis)) {
    throw new Error("Jenis transaksi tidak valid.");
  }

  const jumlah = Number(input.jumlah);
  if (!Number.isFinite(jumlah) || jumlah <= 0) {
    throw new Error("Jumlah transaksi harus lebih besar dari nol.");
  }

  if (!input.tanggal) throw new Error("Tanggal transaksi wajib diisi.");
  if (!input.akun) throw new Error("Akun transaksi wajib diisi.");
  if (!input.kategori) throw new Error("Kategori transaksi wajib diisi.");

  return {
    jenis,
    tanggal: input.tanggal,
    jumlah,
    akun: String(input.akun),
    kategori: String(input.kategori),
    keterangan: input.keterangan ? String(input.keterangan) : null,
  };
}

export async function listTransactions(client, { from, to } = {}) {
  const supabase = requireClient(client);
  let query = supabase
    .from("transactions")
    .select("*")
    .order("tanggal", { ascending: false });

  if (from) query = query.gte("tanggal", from);
  if (to) query = query.lte("tanggal", to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTransaction(client, input) {
  const supabase = requireClient(client);
  const row = normalizeTransaction(input);

  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTransaction(client, id, input) {
  const supabase = requireClient(client);
  if (!id) throw new Error("ID transaksi wajib diisi.");
  const row = normalizeTransaction(input);

  const { data, error } = await supabase
    .from("transactions")
    .update(row)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTransaction(client, id) {
  const supabase = requireClient(client);
  if (!id) throw new Error("ID transaksi wajib diisi.");

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
