/** Supabase recurring transaction service boundary. */

function requireClient(client) {
  if (!client || typeof client.rpc !== "function") {
    throw new Error("Supabase client tidak tersedia.");
  }
  return client;
}

export async function createRecurringTransaction(client, input) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.rpc("create_recurring_transaction", {
    p_recurring_id: input.recurringId,
    p_due_date: input.dueDate,
    p_jenis: input.jenis,
    p_jumlah: Number(input.jumlah),
    p_akun: input.akun,
    p_kategori: input.kategori,
    p_keterangan: input.keterangan || null,
    p_mata_uang: input.mataUang || null,
    p_kurs: input.kurs != null ? Number(input.kurs) : null,
    p_jumlah_idr: input.jumlahIdr != null ? Number(input.jumlahIdr) : null,
  });
  if (error) throw error;
  return data;
}
