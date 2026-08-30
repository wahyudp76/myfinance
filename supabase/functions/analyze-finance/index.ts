// supabase/functions/analyze-finance/index.ts
//
// Edge Function untuk EMPAT fitur di MyFinance yang sama-sama butuh Gemini AI:
//   1. "Rekomendasi AI" (dashboard) -- body TANPA "question"/"mode" -> balas array insight JSON.
//   2. "Tanya AI" (tab Analisis, chat bebas)      -- body DENGAN field "question" -> balas teks jawaban.
//   3. "Ringkasan Bulanan" (tab Laporan)  -- body DENGAN mode: "monthly_summary" -> balas 1 paragraf.
//   4. "Smart Categorization" (form Catat Transaksi) -- body DENGAN mode: "suggest_category" ->
//      balas {"kategori": "..."} , dipicu debounced saat user ngetik field Keterangan.
//
// SUMBER FILE INI: di-recover langsung dari deployment live (Supabase MCP get_edge_function)
// tanggal 25 Agustus 2026 -- sebelumnya TIDAK ADA sama sekali di git manapun (lihat
// docs/AUDIT_REPORT_2026-08.md §4.7 dan commit riwayat Phase 6 di branch ini). ada function LAIN
// bernama "smooth-processor" yang deploy live juga masih aktif berisi versi LAMA fitur ini
// (pakai Anthropic Claude, bukan Gemini, cuma 2 dari 4 mode) -- itu bukan file ini, tidak
// dipanggil dari index.html sama sekali, dan disarankan dihapus manual
// (`supabase functions delete smooth-processor`) krn masih aktif & bisa diakses publik langsung
// walau sudah tidak dipakai.
//
// KENAPA INI HARUS LEWAT EDGE FUNCTION (bukan dipanggil langsung dari browser)?
// API key Gemini HARUS dirahasiakan di server. Kalau dipanggil langsung dari kode
// client (index.html), siapa pun yang membuka DevTools bisa mencuri key itu dan
// memakainya atas nama akun Google AI-mu (kena tagihan/kuota kamu). Edge Function
// ini berjalan di server Supabase, menyimpan key lewat "secret" (env var) yang
// tidak pernah dikirim ke browser -- browser cuma mengirim RINGKASAN keuangan
// (angka agregat, bukan API key) + pertanyaan bebas kalau ada, dan menerima
// balasan JSON dari Gemini.
//
// CARA DEPLOY (lihat juga README.md bagian "Setup Rekomendasi AI"):
//   1. Install Supabase CLI: https://supabase.com/docs/guides/cli
//   2. supabase login
//   3. supabase link --project-ref <project-ref-kamu>
//   4. Ambil API key Gemini di https://aistudio.google.com/apikey (biasanya
//      diawali "AIzaSy..."), lalu simpan sebagai secret:
//      supabase secrets set GEMINI_API_KEY=AIzaSy-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   5. supabase functions deploy analyze-finance
//
// Setelah itu section "Rekomendasi AI" (dashboard) dan "Tanya AI" (tab Analisis) berfungsi.
//
// CATATAN: function ini sekarang live dengan verify_jwt=true (diaktifkan setelah audit Phase 6
// -- sebelumnya false). Keempat Edge Function lain di project ini (scan-receipt, get-exchange-
// rate, refresh-asset-price, whatsapp-webhook) sudah lama verify_jwt=true dan terbukti jalan
// normal memakai pola panggilan client yang SAMA PERSIS (supabaseClient.functions.invoke(...),
// yang otomatis menyertakan JWT valid -- baik JWT sesi user maupun anon key -- di header
// Authorization), jadi flip ini seharusnya tidak mengubah perilaku apa pun utk pemanggilan yang
// sah. Sekarang platform Supabase MENOLAK request yang authorization header-nya sama sekali
// bukan JWT valid SEBELUM kode di bawah sempat jalan -- lapis pertahanan tambahan di atas
// pengecekan auth.getUser() manual yang tetap dipertahankan sebagai lapis kedua.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// Model default: gemini-3.6-flash -- tier "Flash" (cepat & hemat biaya), cukup untuk
// menganalisis ringkasan angka yang sudah dirapikan (bukan model reasoning berat).
// Fitur ini bisa terpanggil cukup sering (tiap dashboard dibuka / tiap ada transaksi
// baru, dengan jeda minimal 3 menit), jadi model tier murah/cepat sengaja dipilih.
// Mau lebih hemat lagi? Ganti ke "gemini-3.5-flash-lite". Mau analisis lebih dalam?
// Ganti ke model "pro" terbaru -- cek daftar model aktif di https://ai.google.dev/gemini-api/docs/models
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// SUPABASE_ANON_KEY disediakan otomatis oleh Supabase di semua Edge Function, tidak perlu diset manual.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// Rate limit server-side (Phase 6) -- lihat sql/migration_rate_limiting_2026-08.sql, RPC
// check_and_consume_rate_limit() di tabel public.api_rate_limits (BUKAN tabel `rate_limits` yang
// dipakai kode "MIN_GAP_MS" di bawah -- itu tabel lain, punya schema berbeda, punya tujuan
// berbeda: gap ANTAR pesan chat, bukan hitungan total per jam). Sebelum ditambahkan di sini,
// mode "insights"/"monthly_summary"/"suggest_category" TIDAK punya pembatasan apa pun sama
// sekali -- suggest_category paling berisiko krn ke-trigger otomatis tiap user berhenti ngetik.
const RATE_LIMITS = {
  suggest_category: { max: 60, windowMinutes: 60 }, // paling sering: ke-trigger tiap jeda ngetik
  insights: { max: 20, windowMinutes: 60 },
  monthly_summary: { max: 20, windowMinutes: 60 },
  question: { max: 40, windowMinutes: 60 }, // TAMBAHAN di atas MIN_GAP_MS yg sudah ada (lihat bawah)
} as const;

async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  action: keyof typeof RATE_LIMITS,
): Promise<boolean> {
  const { max, windowMinutes } = RATE_LIMITS[action];
  const { data: allowed, error } = await supabase.rpc("check_and_consume_rate_limit", {
    p_user_id: userId,
    p_action: `analyze-finance-${action}`,
    p_max_calls: max,
    p_window_minutes: windowMinutes,
  });
  // Fail-open kalau RPC-nya sendiri error -- jangan sampai fitur AI mati total gara-gara
  // masalah infra rate-limiting yang tidak ada hubungannya dgn fitur itu sendiri.
  return error ? true : allowed !== false;
}

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

function rateLimitResponse(fitur: string) {
  return jsonResponse({ error: `Terlalu banyak permintaan ${fitur} dalam 1 jam terakhir. Coba lagi sebentar lagi.` }, 429);
}

// Panggilan ke Gemini generateContent -- satu prompt teks tunggal (bukan percakapan
// multi-giliran, karena tiap request di sini sudah membawa seluruh konteks yang perlu
// lewat ringkasan keuangan + pertanyaan, jadi cukup 1 "user turn").
async function callGemini(promptText: string) {
  const resp = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY!,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Response(
      JSON.stringify({ error: "Gagal memanggil Gemini API", detail: errText }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return String(text);
}

Deno.serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({
      error:
        "GEMINI_API_KEY belum diset di Supabase secrets. Jalankan: supabase secrets set GEMINI_API_KEY=AIzaSy-xxxx",
    }, 500);
  }

  // Verifikasi bahwa yang memanggil adalah user yang sudah login (JWT dari header
  // Authorization, otomatis dikirim oleh supabaseClient.functions.invoke() di client).
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
    const { question, mode, ...summary } = body || {};

    // Mode "Smart Categorization" (form Catat Transaksi) -- BEDA dari mode2 lain di file ini: tidak
    // butuh ringkasan keuangan (commonContext di bawah), cuma butuh teks keterangan singkat + daftar
    // kategori valid milik user ini sendiri. Ditaruh PALING ATAS (sebelum commonContext dibangun)
    // karena payload & prompt-nya sama sekali berbeda bentuk, dan ini dipicu SERING (tiap user
    // berhenti ngetik >700ms), jadi prompt-nya sengaja dibuat seringkas mungkin.
    if (mode === "suggest_category") {
      if (!(await checkRateLimit(supabase, userData.user.id, "suggest_category"))) {
        return rateLimitResponse("saran kategori");
      }

      const keterangan = String(body?.keterangan || "").slice(0, 200); // batasi panjang input
      const jenis = body?.jenis === "Pemasukan" ? "Pemasukan" : "Pengeluaran";
      const categories: string[] = Array.isArray(body?.categories) ? body.categories.slice(0, 100) : [];
      if (!keterangan || categories.length === 0) {
        return jsonResponse({ kategori: null });
      }

      const catPrompt =
        `User sedang mencatat transaksi ${jenis} di aplikasi pencatatan keuangan, dengan keterangan: "${keterangan}". ` +
        `Dari daftar kategori berikut (HARUS PERSIS SAMA PENULISANNYA, case-sensitive, JANGAN membuat nama baru): ` +
        `[${categories.join(", ")}]\n` +
        `Pilih SATU kategori yang PALING cocok. Kalau tidak ada satupun yang cukup relevan/yakin, balas null. ` +
        `Balas HANYA JSON valid, tanpa markdown/backtick/teks lain, format persis: {"kategori": string atau null}`;

      let rawText: string;
      try {
        rawText = await callGemini(catPrompt);
      } catch (errResp) {
        if (errResp instanceof Response) return errResp;
        throw errResp;
      }
      try {
        const cleaned = rawText.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        // Jaga2: cuma terima kalau AI benar2 balas salah satu dari daftar yg dikirim, JANGAN
        // percaya buta -- kalau AI "mengarang" nama kategori baru, anggap saja tidak ada saran.
        const kategori = (parsed?.kategori && categories.includes(parsed.kategori)) ? parsed.kategori : null;
        return jsonResponse({ kategori });
      } catch (_e) {
        return jsonResponse({ kategori: null });
      }
    }

    // Ringkasan (dari buildFinanceSummaryForAI() di index.html) SUDAH berupa angka agregat
    // per bulan/kategori -- bukan daftar transaksi mentah -- supaya payload kecil & tidak
    // membocorkan detail transaksi individual (keterangan, dll) ke prompt lebih dari perlu.
    const commonContext =
      `Kamu asisten analisis keuangan pribadi untuk aplikasi pencatatan keuangan Indonesia (mata uang Rupiah/IDR). ` +
      `Berikut ringkasan keuangan user BULAN BERJALAN ini:\n\n${
        JSON.stringify(summary, null, 2)
      }\n\n`;

    // Mode "Ringkasan Bulanan" (kartu di tab Laporan) -- fokus 1 paragraf naratif RETROSPEKTIF
    // tentang bulan LALU (field pemasukan_bulan_lalu/pengeluaran_bulan_lalu di summary), beda dari
    // mode insight di bawah yang fokus ke bulan berjalan yang masih aktif dicatat.
    if (mode === "monthly_summary") {
      if (!(await checkRateLimit(supabase, userData.user.id, "monthly_summary"))) {
        return rateLimitResponse("ringkasan bulanan");
      }

      const summaryPrompt = commonContext +
        `Tulis SATU paragraf ringkasan laporan keuangan BULAN LALU (pakai field pemasukan_bulan_lalu & ` +
        `pengeluaran_bulan_lalu di atas sebagai fokus utama, bukan bulan berjalan), dalam Bahasa Indonesia, ` +
        `nada suportif dan mudah dibaca orang awam (BUKAN laporan akuntansi formal), maksimal 4-5 kalimat. ` +
        `Sebutkan angka pemasukan & pengeluaran bulan lalu, bandingkan singkat dengan bulan sebelumnya kalau ` +
        `datanya mengindikasikan tren naik/turun, dan sebut 1 kategori pengeluaran terbesar kalau relevan. ` +
        `HANYA berdasarkan angka pada ringkasan di atas, jangan mengarang angka/kategori yang tidak ada. ` +
        `Kalau datanya kosong/terlalu sedikit, katakan dengan jujur belum cukup data untuk bulan lalu. ` +
        `Balas HANYA teks paragrafnya saja, tanpa format JSON, tanpa markdown, tanpa basa-basi pembuka.`;

      let summaryText: string;
      try {
        summaryText = await callGemini(summaryPrompt);
      } catch (errResp) {
        if (errResp instanceof Response) return errResp;
        throw errResp;
      }
      return jsonResponse({ summary: summaryText.trim() || "Belum ada ringkasan." });
    }

    // Mode "Tanya AI" (chat bebas dari tab Analisis) -- ada field "question" di body.
    // Beda dari mode wawasan otomatis di bawah: di sini balasannya teks bebas (bukan JSON array),
    // karena ini percakapan, bukan daftar kartu insight.
    if (question && String(question).trim()) {
      // Rate limit LAMA (sudah ada sebelum Phase 6, DIPERTAHANKAN apa adanya): jeda MINIMAL 8
      // detik ANTAR pesan -- beda tujuan dari limit hitungan-per-jam di bawah. Tabel `rate_limits`
      // di sini BUKAN `public.api_rate_limits` yang baru -- schema & tujuannya sengaja berbeda,
      // tidak digabung supaya tidak mengubah perilaku yang sudah terbukti jalan.
      const MIN_GAP_MS = 8000; // 8 detik
      const { data: rl } = await supabase
        .from("rate_limits")
        .select("last_ai_chat_at")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (rl?.last_ai_chat_at) {
        const elapsed = Date.now() - new Date(rl.last_ai_chat_at).getTime();
        if (elapsed < MIN_GAP_MS) {
          const waitSec = Math.ceil((MIN_GAP_MS - elapsed) / 1000);
          return jsonResponse({
            error: `Tunggu ${waitSec} detik lagi sebelum kirim pesan berikutnya ya.`,
          }, 429);
        }
      }

      // Rate limit BARU (Phase 6): batas TOTAL per jam, sebagai lapis TAMBAHAN di atas jeda 8
      // detik di atas -- jeda 8 detik saja secara teori masih mengizinkan ~450 pesan/jam kalau
      // dikirim terus-menerus tanpa henti; ini menutup celah itu.
      if (!(await checkRateLimit(supabase, userData.user.id, "question"))) {
        return rateLimitResponse("pertanyaan Tanya AI");
      }

      const qaPrompt = commonContext +
        `User bertanya: "${String(question).trim()}"\n\n` +
        `Jawab pertanyaan itu dalam Bahasa Indonesia, singkat (maksimal 3-4 kalimat), HANYA berdasarkan ` +
        `angka pada ringkasan di atas. Kalau ringkasan datanya tidak cukup untuk menjawab pertanyaan itu ` +
        `secara spesifik (misal user tanya soal kategori/periode yang tidak ada di ringkasan), katakan ` +
        `dengan jujur bahwa datanya tidak tersedia di ringkasan ini, jangan mengarang angka. ` +
        `Balas HANYA teks jawabannya saja, tanpa format JSON, tanpa markdown, tanpa basa-basi pembuka.`;

      let answerText: string;
      try {
        answerText = await callGemini(qaPrompt);
      } catch (errResp) {
        if (errResp instanceof Response) return errResp;
        throw errResp;
      }
      // Catat waktu panggilan yang BERHASIL saja (kalau Gemini-nya gagal, tidak dihitung, biar user
      // tidak "kena jeda" gara2 error yang bukan salah dia).
      await supabase.from("rate_limits").upsert({ user_id: userData.user.id, last_ai_chat_at: new Date().toISOString() });
      return jsonResponse({ answer: answerText.trim() || "Maaf, tidak ada jawaban." });
    }

    // Mode wawasan otomatis (dipanggil dari renderInsights() di dashboard) -- balasannya array
    // JSON berisi maksimal 3 kartu insight.
    if (!(await checkRateLimit(supabase, userData.user.id, "insights"))) {
      return rateLimitResponse("rekomendasi AI");
    }

    const prompt = commonContext +
      `Berikan MAKSIMAL 3 rekomendasi/insight yang KONKRET, SPESIFIK, dan actionable dalam Bahasa Indonesia, ` +
      `HANYA berdasarkan angka pada data di atas (jangan mengarang angka atau kategori yang tidak ada di data). ` +
      `Kalau datanya terlalu sedikit/kosong untuk disimpulkan, cukup kasih 1 insight umum yang menyemangati/mengingatkan. ` +
      `Balas HANYA dalam bentuk JSON array valid (tanpa markdown, tanpa backtick, tanpa teks lain di luar array), formatnya:\n` +
      `[{"title": "judul singkat (maks 6 kata)", "message": "penjelasan 1-2 kalimat", "severity": "info" | "warning" | "success"}]`;

    let rawText: string;
    try {
      rawText = await callGemini(prompt);
    } catch (errResp) {
      if (errResp instanceof Response) return errResp;
      throw errResp;
    }

    let insights: any[] = [];
    try {
      const cleaned = (rawText || "[]").replace(/```json|```/g, "").trim();
      insights = JSON.parse(cleaned);
      if (!Array.isArray(insights)) insights = [insights];
    } catch (_e) {
      // Kalau Gemini tidak balas JSON murni (jarang terjadi, tapi jaga-jaga), tetap tampilkan
      // teksnya apa adanya sebagai satu insight, daripada gagal total.
      insights = [{
        title: "Analisis Gemini",
        message: rawText || "Tidak ada respons dari Gemini.",
        severity: "info",
      }];
    }

    return jsonResponse({ insights });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
