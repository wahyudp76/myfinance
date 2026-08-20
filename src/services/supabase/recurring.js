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
  });
  if (error) throw error;
  return data;
}
