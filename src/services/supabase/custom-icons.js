/** Supabase custom-icon service boundary (tabel: custom_icons, 1 baris per akun per user). */

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

async function getCurrentUserId(client) {
  const { data, error } = await requireClient(client).auth.getUser();
  if (error || !data.user) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  return data.user.id;
}

/** @returns {Record<string, object>} peta nama akun -> data ikon kustomnya */
export async function getCustomIcons(client) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.from("custom_icons").select("account_name, icon_data");
  if (error) throw error;
  const result = {};
  for (const row of data || []) result[row.account_name] = row.icon_data;
  return result;
}

export async function saveCustomIcon(client, accountName, iconObj) {
  const supabase = requireClient(client);
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("custom_icons")
    .upsert({ user_id, account_name: accountName, icon_data: iconObj }, { onConflict: "user_id,account_name" });
  if (error) throw error;
}

export async function deleteCustomIcon(client, accountName) {
  const supabase = requireClient(client);
  const { error } = await supabase.from("custom_icons").delete().eq("account_name", accountName);
  if (error) throw error;
}
