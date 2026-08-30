/**
 * Supabase Edge Function service boundary -- pemanggilan functions.invoke
 * utk fitur berbasis AI/eksternal. Dulunya body suggestCategoryRemote() /
 * getExchangeRateRemote() / scanReceiptRemote() di adapter `api`
 * (index.html) -- dipindah utuh saat pensyahan api.run (slice edge
 * functions; refresh-asset-price sudah lebih dulu pindah ke assets.js).
 * Konvensi dua lapis error dipertahankan persis: error transport dari
 * functions.invoke DAN error aplikasi di body (data.error) sama-sama
 * dijadikan throw, supaya .catch pemanggil cukup satu jalur.
 */

function requireClient(client) {
  if (!client || typeof client.functions !== "object" || typeof client.functions.invoke !== "function") {
    throw new Error("Supabase client tidak tersedia.");
  }
  return client;
}

/**
 * Edge Function 'analyze-finance' mode "suggest_category" -- saran kategori
 * dari teks keterangan + daftar kategori valid milik user (Gemini hanya boleh
 * memilih dari kategori yang benar-benar ada).
 */
export async function suggestCategory(client, keterangan, jenis, categories) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.functions.invoke("analyze-finance", {
    body: { mode: "suggest_category", keterangan, jenis, categories }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}

/** Edge Function 'get-exchange-rate' -- kurs mata uang ke IDR terkini. */
export async function getExchangeRate(client, mataUang) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.functions.invoke("get-exchange-rate", { body: { mata_uang: mataUang } });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}

/**
 * Edge Function 'scan-receipt' -- foto struk (sudah dikompres di client,
 * lihat compressImageDataUrl) + daftar kategori Pengeluaran user, hasilnya
 * auto-isi form transaksi (lihat applyStrukResultToForm).
 */
export async function scanReceipt(client, imageBase64, mimeType, categories) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.functions.invoke("scan-receipt", {
    body: { image_base64: imageBase64, mime_type: mimeType, categories }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}
