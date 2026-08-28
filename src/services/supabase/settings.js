/** Supabase settings service boundary (tabel: settings, 1 baris JSON per user). */

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

async function getCurrentUserId(client) {
  const { data, error } = await requireClient(client).auth.getUser();
  if (error || !data.user) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  return data.user.id;
}

/**
 * Ambil objek pengaturan user (accounts, custom_categories, account_currencies, debts,
 * financial goals, dll -- semuanya 1 JSON blob, lihat kolom `data` di tabel `settings`).
 * @returns {object|null} null = user baru, belum pernah menyimpan pengaturan sama sekali.
 */
export async function getSettings(client) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.from("settings").select("data").maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

/**
 * Simpan/timpa seluruh objek pengaturan user (upsert 1 baris per user_id).
 * Pemanggil bertanggung jawab menyusun `settingsObj` secara lengkap -- ini bukan partial
 * update, jadi field yang tidak disertakan akan HILANG dari baris tersimpan.
 */
export async function saveSettings(client, settingsObj) {
  const supabase = requireClient(client);
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id, data: settingsObj, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}
