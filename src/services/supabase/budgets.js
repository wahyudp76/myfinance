/** Supabase budget service boundary. */

function requireClient(client) {
  if (!client || typeof client.rpc !== "function") {
    throw new Error("Supabase client tidak tersedia.");
  }
  return client;
}

export async function replaceMonthBudgets(client, month, budgets) {
  const supabase = requireClient(client);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Bulan harus berformat YYYY-MM.");
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    throw new Error("Budget harus berupa object map { kategori: jumlah }.");
  }
  // RPC-nya (lihat replace_month_budgets di database) eksplisit menolak apa pun yang bukan
  // JSON *object* ("budgets must be a JSON object") -- object map di sini sudah persis bentuk
  // yang dibutuhkan, jadi cuma perlu divalidasi & angkanya dinormalisasi jadi Number.
  const budgetsMap = {};
  for (const [kategori, jumlahRaw] of Object.entries(budgets)) {
    const jumlah = Number(jumlahRaw);
    if (!Number.isFinite(jumlah) || jumlah < 0) throw new Error(`Jumlah budget untuk kategori "${kategori}" tidak valid.`);
    budgetsMap[kategori] = jumlah;
  }

  const { data, error } = await supabase.rpc("replace_month_budgets", {
    p_bulan: month,
    p_budgets: budgetsMap,
  });
  if (error) throw error;
  return data;
}

/**
 * Ambil budget satu bulan sebagai object map { kategori: jumlah }.
 * Dulunya fungsi internal getBudgetsRemote() di adapter `api` (index.html)
 * -- dipindah ke sini saat pensiunnya pola api.run (slice "budgets"), body
 * persis sama; adapter lama tinggal mendelegasi ke sini sebelum akhirnya
 * dihapus utuh. Kolom jumlah datang sebagai string numeric dari Postgres,
 * jadi dinormalisasi ke Number persis seperti versi lama.
 */
export async function fetchMonthBudgets(client, month) {
  const supabase = requireClient(client);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Bulan harus berformat YYYY-MM.");
  const { data, error } = await supabase
    .from("budgets")
    .select("kategori, jumlah")
    .eq("bulan", month);
  if (error) throw error;
  const map = {};
  (data || []).forEach(row => { map[row.kategori] = Number(row.jumlah); });
  return map;
}
