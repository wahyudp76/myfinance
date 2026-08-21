import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchAll(client) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("transactions")
      .select("id, jenis, tanggal, jumlah, akun, kategori, keterangan, mata_uang, kurs, jumlah_idr")
      .order("tanggal", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function createHeadlessLegacyTransactionRead() {
  const client = createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: required("PARITY_TEST_EMAIL"),
    password: required("PARITY_TEST_PASSWORD"),
  });
  if (error) throw error;

  return () => fetchAll(client);
}
