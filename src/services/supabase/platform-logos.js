/** Katalog global logo platform aset/investasi dari tabel platform_logos. */
function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

export async function listPlatformLogos(client) {
  const supabase = requireClient(client);
  const { data, error } = await supabase
    .from("platform_logos")
    .select("platform_key, display_name, logo_url, source_url")
    .eq("is_active", true)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return data || [];
}
