/** Supabase asset/investment service boundary (tabel: assets). */
import { getCurrentUserId } from "../user-id.js";
import { fetchAllRows } from "./paging.js";

function requireClient(client) {
  if (!client) throw new Error("Supabase client belum diberikan.");
  return client;
}

// PostgREST membatasi maksimal ~1000 baris per response secara default. Jarang
// ada user dengan >1000 aset, tapi helper bersama fetchAllRows (v56) tetap
// dipasang supaya tidak diam-diam terpotong kalau suatu saat itu terjadi --
// dan bila itu terjadi, halamannya di-fetch PARALEL (kontrak sama dengan
// transaksi, lihat src/services/supabase/paging.js).

export async function listAssets(client) {
  const supabase = requireClient(client);
  const rows = await fetchAllRows(supabase, (from, to, opts) =>
    supabase
      .from("assets")
      .select(
        "id, nama, kategori, platform, modal, nilai, terakhir, value_history, simbol, jumlah_unit, sumber_harga",
        opts && opts.withCount ? { count: "exact" } : undefined
      )
      .order("terakhir", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  return rows.map((row) => ({
    ...row,
    modal: Number(row.modal),
    nilai: Number(row.nilai),
    value_history: row.value_history || [],
  }));
}

export async function createAsset(client, data) {
  const supabase = requireClient(client);
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase.from("assets").insert({
    user_id,
    nama: data.nama,
    kategori: data.kategori,
    platform: data.platform || null,
    modal: Number(data.modal),
    nilai: Number(data.nilai),
    value_history: data.value_history || [],
    simbol: data.simbol || null,
    jumlah_unit: data.jumlah_unit || null,
    sumber_harga: data.sumber_harga || null,
  });
  if (error) throw error;
}

export async function updateAsset(client, id, data) {
  const supabase = requireClient(client);
  // Defense-in-depth (v56): id memang PK unik & RLS sudah membatasi ke baris
  // milik user sendiri, tapi filter user_id eksplisit menyamakan pola service
  // transaksi (update/remove di src/services/transactions.js) -- salah-pasti
  // id aset user lain tidak pernah tersentuh walau RLS keliru dimatikan.
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase
    .from("assets")
    .update({
      nama: data.nama,
      kategori: data.kategori,
      platform: data.platform || null,
      modal: Number(data.modal),
      nilai: Number(data.nilai),
      terakhir: new Date().toISOString(),
      value_history: data.value_history,
      simbol: data.simbol || null,
      jumlah_unit: data.jumlah_unit || null,
      sumber_harga: data.sumber_harga || null,
    })
    .eq("id", id)
    .eq("user_id", user_id);
  if (error) throw error;
}

export async function deleteAsset(client, id) {
  const supabase = requireClient(client);
  const user_id = await getCurrentUserId(supabase);
  const { error } = await supabase.from("assets").delete().eq("id", id).eq("user_id", user_id);
  if (error) throw error;
}

/**
 * Refresh harga aset lewat Edge Function 'refresh-asset-price' -- TIDAK
 * query tabel assets langsung dari client karena logic ambil harga
 * (CoinGecko dsb) + hitung nilai baru + update value_history terjadi di
 * server. Dulunya body refreshAssetPriceRemote() di adapter `api`
 * (index.html) -- dipindah saat pensyahan api.run (slice assets), body
 * persis sama termasuk dua lapis error (error transport & data.error).
 */
export async function refreshAssetPrice(client, assetId) {
  const supabase = requireClient(client);
  const { data, error } = await supabase.functions.invoke("refresh-asset-price", { body: { asset_id: assetId } });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}
