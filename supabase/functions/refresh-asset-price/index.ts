// supabase/functions/refresh-asset-price/index.ts
//
// Edge Function untuk fitur "Refresh Harga Otomatis" di menu Aset -> Detail Aset.
// Beda dari analyze-finance (yang manggil Gemini): function ini manggil API HARGA PASAR
// (saat ini baru CoinGecko, buat Kripto) lalu MENULIS LANGSUNG ke tabel `assets` --
// bukan cuma mengembalikan teks/insight.
//
// SUMBER FILE INI: di-recover langsung dari deployment live (Supabase MCP get_edge_function)
// tanggal 25 Agustus 2026 -- sebelumnya TIDAK ADA sama sekali di git manapun, lihat
// docs/AUDIT_REPORT_2026-08.md §4.7 dan commit riwayat Phase 6 di branch ini.
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
// Setelah itu tombol "Refresh Harga" di Detail Aset akan berfungsi utk semua sumber:
// Kripto (ID CoinGecko + Jumlah Koin), Saham IDX (kode + jumlah lembar), dan REKSADANA
// (nama dana di Bibit + jumlah unit, sumber_harga "reksadana_bibit" -- NAB/UP pasar riil).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildBibitListUrl,
  decryptBibitPayload,
  extractBibitItems,
  pickBibitFundMatch,
  listSimilarFundNames,
} from "../_shared/bibit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// SUPABASE_ANON_KEY disediakan otomatis oleh Supabase di semua Edge Function, tidak perlu diset manual.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// Rate limit server-side (Phase 6) -- lihat sql/migration_rate_limiting_2026-08.sql. Ini tombol
// klik manual (bukan auto-trigger), tapi tetap dibatasi buat jaga-jaga penyalahgunaan/beban ke
// CoinGecko & Yahoo Finance yang rate limit publiknya dibagi bersama SEMUA pengguna aplikasi ini.
const RATE_LIMIT_ACTION = "refresh-asset-price";
const RATE_LIMIT_MAX_CALLS = 30;
const RATE_LIMIT_WINDOW_MINUTES = 60;

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

// EKSPERIMENTAL & TIDAK RESMI: ambil harga saham IDX (Bursa Efek Indonesia) lewat endpoint
// "chart" Yahoo Finance (dipakai luas oleh developer buat data saham, kode ditambah akhiran
// ".JK"), TAPI ini bukan API resmi/didukung Yahoo -- bisa berubah/berhenti berfungsi sewaktu2
// tanpa pemberitahuan. Kalau function ini mulai gagal terus, endpoint-nya kemungkinan sudah
// berubah dan perlu diganti sumbernya.
async function fetchYahooIdStockPriceIdr(kodeSaham: string): Promise<number> {
  const ticker = kodeSaham.toUpperCase().endsWith(".JK")
    ? kodeSaham.toUpperCase()
    : `${kodeSaham.toUpperCase()}.JK`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MyFinanceApp/1.0)" },
  });
  if (!resp.ok) {
    throw new Error(
      `Yahoo Finance API error (status ${resp.status}). Endpoint ini tidak resmi/tidak stabil -- coba lagi nanti, atau kabari kalau terus gagal supaya sumbernya diganti.`,
    );
  }
  const data = await resp.json();
  const harga = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof harga !== "number") {
    throw new Error(
      `Kode saham "${kodeSaham}" tidak ditemukan (dicoba sebagai "${ticker}"). Cek lagi kode IDX-nya (4 huruf, misal BBCA, TLKM, BBRI).`,
    );
  }
  return harga;
}

// REKSADANA (sumber "reksadana_bibit", ditambah 2026-09): NAB/UP terkini dari API publik
// Bibit -- diverifikasi hidup & stabil (payload terenkripsi AES-256-CBC; helper dekripsi,
// pencocokan nama, dan pesan kandidat mirip di ../_shared/bibit.js, teruji unit).
// `simbol` = nama dana (persis seperti di aplikasi Bibit/Bareksa) ATAU ID produk Bibit.
// KENAPA harus dari Edge Function: API Bibit mengirim Access-Control-Allow-Origin terpatri
// ke https://bibit.id, jadi browser aplikasi pasti diblok CORS; server-ke-server aman.
async function fetchBibitFundNavIdr(simbol: string): Promise<number> {
  const headers = {
    Accept: "application/json",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (compatible; MyFinanceApp/1.0; +refresh-asset-price)",
    Origin: "https://bibit.id",
    Referer: "https://bibit.id/",
  };
  const fetchItems = async (query: string, limit: number) => {
    const resp = await fetch(buildBibitListUrl(query, limit), { headers });
    if (!resp.ok) {
      throw new Error(`API Bibit error (status ${resp.status}). Coba lagi sebentar lagi.`);
    }
    const body = await resp.json();
    return decryptBibitPayload(extractBibitItems(body));
  };

  let items: unknown[];
  try {
    items = await fetchItems(simbol, 20);
  } catch (e) {
    // Pencarian nama penuh kosong (API Bibit ketat): coba lagi dgn token pertama
    // (mis. "Bahana") lalu cocokkan ulang dgn nama lengkap.
    const firstToken = String(simbol).trim().split(/\s+/)[0];
    if (!firstToken || firstToken === String(simbol).trim()) throw e;
    items = await fetchItems(firstToken, 50);
  }

  const match = pickBibitFundMatch(items, simbol);
  if (!match) {
    const mirip = listSimilarFundNames(items, simbol);
    throw new Error(
      mirip.length
        ? `Nama dana "${simbol}" tidak persis/ambigu. Dana mirip di Bibit: ${mirip.join(" | ")}. Salin salah satu nama persis ke kolom Simbol, lalu refresh lagi.`
        : `Dana "${simbol}" tidak ditemukan di Bibit. Periksa ejaan nama dana (persis seperti di aplikasi Bibit).`,
    );
  }
  return match.navValue;
}

// Registry sumber harga -- tambah entry baru di sini kalau nanti ada sumber lain
// (mis. Emas) yang sudah terverifikasi reliable.
const PRICE_FETCHERS: Record<string, (simbol: string) => Promise<number>> = {
  coingecko: fetchCoinGeckoPriceIdr,
  yahoo_id_stock: fetchYahooIdStockPriceIdr,
  reksadana_bibit: fetchBibitFundNavIdr,
};

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

    const { data: allowed, error: rateLimitErr } = await supabase.rpc("check_and_consume_rate_limit", {
      p_user_id: userData.user.id,
      p_action: RATE_LIMIT_ACTION,
      p_max_calls: RATE_LIMIT_MAX_CALLS,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    });
    if (!rateLimitErr && allowed === false) {
      return jsonResponse({
        error: `Terlalu banyak refresh harga dalam ${RATE_LIMIT_WINDOW_MINUTES} menit terakhir. Coba lagi sebentar lagi.`,
      }, 429);
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
          'Aset ini belum diisi kolom Simbol/ID & Jumlah Unit. Isi dulu lewat Edit Aset.',
      }, 400);
    }
    const fetcher = PRICE_FETCHERS[asset.sumber_harga];
    if (!fetcher) {
      return jsonResponse({
        error: `Sumber harga "${asset.sumber_harga || "-"}" belum didukung untuk auto-update.`,
      }, 400);
    }

    const hargaPerUnit = await fetcher(asset.simbol);
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
