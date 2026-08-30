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

/**
 * Normalisasi argumen snake_case (recurring_id/due_date/...) -> parameter
 * camelCase createRecurringTransaction(). Dulunya bagian mapping di
 * createRecurringTransactionRemote() adapter `api` (index.html) -- dipindah
 * saat pensyahan api.run (slice recurring) supaya rantai idempoten
 * processDueRecurring() bisa manggil service langsung tanpa duplikasi
 * mapping. Koersi PERSIS adapter lama.
 */
export function toCreateRecurringParams(data) {
  return {
    recurringId: data.recurring_id,
    dueDate: data.due_date,
    jenis: data.jenis,
    jumlah: Number(data.jumlah),
    akun: data.akun,
    kategori: data.kategori,
    keterangan: data.keterangan || null,
    mataUang: data.mata_uang || null,
    kurs: data.kurs || null,
    jumlahIdr: data.jumlah_idr != null ? Number(data.jumlah_idr) : null,
  };
}

/**
 * Normalisasi data form transaksi berulang -> payload kolom tabel
 * recurring_transactions (dipakai create & update). Dulunya mapping di
 * addRecurringRemote()/editRecurringRemote() adapter `api` -- jumlah selalu
 * Number (form mengirim string), keterangan/end_date kosong jadi null.
 */
export function toRecurringRecord(data) {
  return {
    jenis: data.jenis,
    jumlah: Number(data.jumlah),
    akun: data.akun,
    kategori: data.kategori,
    keterangan: data.keterangan || null,
    frequency: data.frequency,
    start_date: data.start_date,
    next_due_date: data.next_due_date,
    end_date: data.end_date || null,
  };
}

async function fetchAllRows(client, buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function getCurrentUserId(client) {
  const { data, error } = await requireClient(client).auth.getUser();
  if (error || !data.user) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  return data.user.id;
}

/**
 * Ambil semua template transaksi berulang (paging sampai habis -- PostgREST
 * membatasi ~1000 baris per response). Dulunya body fetchRecurringRemote()
 * di adapter `api` (index.html): kolom, urutan (next_due_date asc, id asc),
 * & normalisasi jumlah ke Number dipertahankan persis.
 */
export async function listRecurring(client) {
  const supabase = requireClient(client);
  const rows = await fetchAllRows(supabase, (from, to) => supabase
    .from("recurring_transactions")
    .select("id, jenis, jumlah, akun, kategori, keterangan, frequency, start_date, next_due_date, end_date, active")
    .order("next_due_date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to));
  return rows.map(row => ({ ...row, jumlah: Number(row.jumlah) }));
}

/** Insert template berulang baru (aktif). Dulunya addRecurringRemote(). */
export async function createRecurring(client, data) {
  const supabase = requireClient(client);
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase.from("recurring_transactions").insert({
    user_id,
    ...toRecurringRecord(data),
    active: true,
  });
  if (error) throw error;
}

/**
 * Update detail template (jumlah/kategori/dst). next_due_date ikut
 * diteruskan dari data (alur form edit mengisinya dari nilai existing --
 * jadwal berjalan tidak ter-reset). Dulunya editRecurringRemote().
 */
export async function updateRecurring(client, id, data) {
  const supabase = requireClient(client);
  const { error } = await supabase.from("recurring_transactions").update(toRecurringRecord(data)).eq("id", id);
  if (error) throw error;
}

/** Hapus template. Dulunya deleteRecurringRemote(). */
export async function deleteRecurring(client, id) {
  const supabase = requireClient(client);
  const { error } = await supabase.from("recurring_transactions").delete().eq("id", id);
  if (error) throw error;
}

/** Jeda/aktifkan template. Dulunya setRecurringActiveRemote(). */
export async function setRecurringActive(client, id, active) {
  const supabase = requireClient(client);
  const { error } = await supabase.from("recurring_transactions").update({ active }).eq("id", id);
  if (error) throw error;
}

/** Maju-mundurkan jadwal template. Dulunya advanceRecurringDueDateRemote(). */
export async function advanceRecurringDueDate(client, id, nextDueDate) {
  const supabase = requireClient(client);
  const { error } = await supabase.from("recurring_transactions").update({ next_due_date: nextDueDate }).eq("id", id);
  if (error) throw error;
}
