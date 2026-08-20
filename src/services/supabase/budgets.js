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

  const normalized = budgets.map((item) => {
    const kategori = String(item?.kategori || "").trim();
    const jumlah = Number(item?.jumlah);
    if (!kategori) throw new Error("Kategori budget wajib diisi.");
    if (!Number.isFinite(jumlah) || jumlah < 0) throw new Error("Jumlah budget tidak valid.");
    return { kategori, jumlah };
  });

  const { data, error } = await supabase.rpc("replace_month_budgets", {
    p_bulan: month,
    p_budgets: normalized,
  });
  if (error) throw error;
  return data;
}
