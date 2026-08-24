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
