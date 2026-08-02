// supabase/functions/get-exchange-rate/index.ts
//
// Edge Function untuk fitur "Multi-currency" -- dipanggil dari modal Catat Transaksi tiap kali
// user pilih akun yang mata uangnya BUKAN IDR, buat ambil kurs terkini (1 <mata_uang> = berapa IDR).
//
// SUMBER: Frankfurter API (https://frankfurter.dev) -- kurs referensi harian dari European Central
// Bank, gratis, TANPA API key. Dipilih karena publik & tanpa key (beda dari CoinGecko yang saya
// cukup yakin, ini levelnya "cukup yakin tapi belum saya verifikasi live" -- kalau ternyata gagal
// terus, kabari supaya dicarikan sumber lain, sama seperti kasus Yahoo Finance untuk Saham).
//
// KENAPA LEWAT EDGE FUNCTION padahal Frankfurter tidak butuh API key rahasia? Supaya konsisten 1
// pola dengan refresh-asset-price, dan supaya kalau nanti ganti sumber kurs yang BUTUH API key,
// tidak perlu ubah apapun di sisi client (index.html) -- cukup ubah function ini.
//
// CARA DEPLOY:
//   supabase functions deploy get-exchange-rate

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
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
    const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const mataUang = String(body?.mata_uang || "").trim().toUpperCase();
    if (!mataUang) {
      return jsonResponse({ error: "mata_uang wajib dikirim (mis. USD)." }, 400);
    }
    if (mataUang === "IDR") {
      return jsonResponse({ rate: 1, tanggal: new Date().toISOString().slice(0, 10) });
    }

    const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(mataUang)}&symbols=IDR`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return jsonResponse({
        error: `Gagal ambil kurs (status ${resp.status}). Kode mata uang "${mataUang}" mungkin tidak valid/tidak didukung, atau layanan kursnya sedang bermasalah.`,
      }, 502);
    }
    const data = await resp.json();
    const rate = data?.rates?.IDR;
    if (typeof rate !== "number") {
      return jsonResponse({
        error: `Kurs untuk "${mataUang}" tidak ditemukan. Cek lagi kode mata uangnya (format 3 huruf, mis. USD, EUR, SGD).`,
      }, 400);
    }

    return jsonResponse({ rate, tanggal: data?.date || new Date().toISOString().slice(0, 10) });
  } catch (e) {
    return jsonResponse({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
