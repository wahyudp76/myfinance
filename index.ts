// supabase/functions/refresh-asset-price/index.ts
//
// Edge Function untuk fitur "Refresh Harga Otomatis" di menu Aset -> Detail Aset.
// Beda dari analyze-finance (yang manggil Gemini): function ini manggil API HARGA PASAR
// (saat ini baru CoinGecko, buat Kripto) lalu MENULIS LANGSUNG ke tabel `assets` --
// bukan cuma mengembalikan teks/insight.
//
// KENAPA LEWAT EDGE FUNCTION (bukan fetch CoinGecko langsung dari browser)?
// Sebenarnya CoinGecko API publik boleh dipanggil langsung dari browser (tidak perlu API key
// rahasia seperti Gemini). Tapi logic "hitung nilai baru + update value_history dengan aturan
// dedupe-per-hari yang SAMA seperti submitAsset() di index.html" lebih aman ditaruh di satu
// tempat (server) supaya konsisten, dan supaya ke depannya kalau nambah sumber harga baru yang
// BUTUH API key rahasia (misal API saham berbayar), pola yang dipakai sudah siap tanpa refactor.
//
// CARA DEPLOY (sama seperti analyze-finance, tidak butuh secret baru):
//   supabase functions deploy refresh-asset-price
//
// Setelah itu tombol "Refresh Harga" di Detail Aset (untuk aset berkategori Kripto yang sudah
// diisi "ID CoinGecko" & "Jumlah Koin Dimiliki" di form Tambah/Edit Aset) akan berfungsi.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// SUPABASE_ANON_KEY disediakan otomatis oleh Supabase di semua Edge Function, tidak perlu diset manual.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Ambil harga terkini (dalam IDR) dari CoinGecko untuk 1 coin id (misal "bitcoin").
// Dokumentasi: https://docs.coingecko.com/reference/simple-price -- endpoint publik, tanpa API key,
// tapi ada rate limit wajar (cukup untuk dipanggil sesekali per user, bukan tiap detik).
async function fetchCoinGeckoPriceIdr(coinId: string): Promise<number> {
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=idr`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`CoinGecko API error (status ${resp.status}). Coba lagi sebentar lagi.`);
  }
  const data = await resp.json();
  const harga = data?.[coinId]?.idr;
  if (typeof harga !== "number") {
    throw new Error(
      `ID CoinGecko "${coinId}" tidak ditemukan/tidak punya harga IDR. Cek lagi ID-nya di halaman koin di coingecko.com.`,
    );
  }
  return harga;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    // Client di-scope ke JWT user yang memanggil -- RLS tabel `assets` otomatis membatasi
    // baris yang bisa dibaca/ditulis cuma milik user ini sendiri (pola sama seperti analyze-finance).
    const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const assetId = body?.asset_id;
    if (!assetId) {
      return jsonResponse({ error: "asset_id wajib dikirim." }, 400);
    }

    const { data: asset, error: fetchErr } = await supabase
      .from("assets")
      .select("id, nilai, simbol, jumlah_unit, sumber_harga, value_history")
      .eq("id", assetId)
      .single();

    if (fetchErr || !asset) {
      return jsonResponse({ error: "Aset tidak ditemukan." }, 404);
    }
    if (!asset.simbol || !asset.jumlah_unit) {
      return jsonResponse({
        error:
          'Aset ini belum diisi "ID CoinGecko" & "Jumlah Koin Dimiliki". Isi dulu lewat Edit Aset.',
      }, 400);
    }
    if (asset.sumber_harga !== "coingecko") {
      return jsonResponse({
        error: `Sumber harga "${asset.sumber_harga || "-"}" belum didukung. Saat ini baru Kripto (CoinGecko) yang bisa auto-update.`,
      }, 400);
    }

    const hargaPerUnit = await fetchCoinGeckoPriceIdr(asset.simbol);
    const nilaiBaru = Math.round(hargaPerUnit * Number(asset.jumlah_unit));

    // Sama seperti submitAsset() di index.html: 1 titik value_history per hari, edit berkali-kali
    // di hari yang sama menimpa titik hari itu, bukan menumpuk.
    const todayStr = new Date().toISOString().slice(0, 10);
    const history = Array.isArray(asset.value_history) ? asset.value_history.slice() : [];
    const sameDayIdx = history.findIndex((h: any) => h.tanggal === todayStr);
    if (sameDayIdx >= 0) history[sameDayIdx] = { tanggal: todayStr, nilai: nilaiBaru };
    else history.push({ tanggal: todayStr, nilai: nilaiBaru });

    const { error: updateErr } = await supabase
      .from("assets")
      .update({ nilai: nilaiBaru, terakhir: new Date().toISOString(), value_history: history })
      .eq("id", assetId);

    if (updateErr) {
      return jsonResponse({ error: "Gagal menyimpan nilai baru: " + updateErr.message }, 500);
    }

    return jsonResponse({ harga_per_unit: hargaPerUnit, nilai_baru: nilaiBaru });
  } catch (e) {
    return jsonResponse({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
