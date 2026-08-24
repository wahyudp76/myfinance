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
  if (!Array.isArray(budgets)) throw new Error("Budget harus berupa array.");

  // RPC-nya (lihat replace_month_budgets di database) eksplisit menolak apa pun yang bukan
  // JSON *object* ("budgets must be a JSON object") -- jadi array of {kategori, jumlah} di atas
  // dikonversi ke object map { [kategori]: jumlah } di sini, BUKAN dikirim apa adanya.
  const budgetsMap = {};
  for (const item of budgets) {
    const kategori = String(item?.kategori || "").trim();
    const jumlah = Number(item?.jumlah);
    if (!kategori) throw new Error("Kategori budget wajib diisi.");
    if (!Number.isFinite(jumlah) || jumlah < 0) throw new Error("Jumlah budget tidak valid.");
    budgetsMap[kategori] = jumlah;
  }

  const { data, error } = await supabase.rpc("replace_month_budgets", {
    p_bulan: month,
    p_budgets: budgetsMap,
  });
  if (error) throw error;
  return data;
}
