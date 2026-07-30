// supabase/functions/analyze-finance/index.ts
//
// Edge Function untuk fitur "Rekomendasi AI" di dashboard MyFinance.
//
// KENAPA INI HARUS LEWAT EDGE FUNCTION (bukan dipanggil langsung dari browser)?
// API key Anthropic HARUS dirahasiakan di server. Kalau dipanggil langsung dari kode
// client (index.html), siapa pun yang membuka DevTools bisa mencuri key itu dan
// memakainya atas nama akun Anthropic-mu. Edge Function ini berjalan di server
// Supabase, menyimpan key lewat "secret" (env var) yang tidak pernah dikirim ke
// browser -- browser cuma mengirim RINGKASAN keuangan (angka agregat, bukan API key),
// dan menerima balasan JSON dari Claude.
//
// CARA DEPLOY (lihat juga README.md bagian "Rekomendasi AI"):
//   1. Install Supabase CLI: https://supabase.com/docs/guides/cli
//   2. supabase login
//   3. supabase link --project-ref <project-ref-kamu>
//   4. supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
//   5. supabase functions deploy analyze-finance --no-verify-jwt=false
//
// Setelah itu tombol refresh di section "Rekomendasi AI" pada dashboard akan berfungsi.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
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

Deno.serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({
      error:
        "ANTHROPIC_API_KEY belum diset di Supabase secrets. Jalankan: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx",
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

    const summary = await req.json();

    // Ringkasan (dari buildFinanceSummaryForAI() di index.html) SUDAH berupa angka agregat
    // per bulan/kategori -- bukan daftar transaksi mentah -- supaya payload kecil & tidak
    // membocorkan detail transaksi individual (keterangan, dll) ke prompt lebih dari perlu.
    const prompt =
      `Kamu asisten analisis keuangan pribadi untuk aplikasi pencatatan keuangan Indonesia (mata uang Rupiah/IDR). ` +
      `Berikut ringkasan keuangan user BULAN BERJALAN ini:\n\n${
        JSON.stringify(summary, null, 2)
      }\n\n` +
      `Berikan MAKSIMAL 3 rekomendasi/insight yang KONKRET, SPESIFIK, dan actionable dalam Bahasa Indonesia, ` +
      `HANYA berdasarkan angka pada data di atas (jangan mengarang angka atau kategori yang tidak ada di data). ` +
      `Kalau datanya terlalu sedikit/kosong untuk disimpulkan, cukup kasih 1 insight umum yang menyemangati/mengingatkan. ` +
      `Balas HANYA dalam bentuk JSON array valid (tanpa markdown, tanpa backtick, tanpa teks lain di luar array), formatnya:\n` +
      `[{"title": "judul singkat (maks 6 kata)", "message": "penjelasan 1-2 kalimat", "severity": "info" | "warning" | "success"}]`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Haiku dipilih karena fitur ini bisa terpanggil cukup sering (tiap dashboard dibuka /
        // tiap ada transaksi baru, dengan jeda minimal 3 menit) -- cepat & murah, cukup untuk
        // menganalisis ringkasan angka yang sudah dirapikan. Ganti ke model lain kalau mau
        // analisis yang lebih dalam (lihat daftar model di dashboard Anthropic Console kamu).
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return jsonResponse({
        error: "Gagal memanggil Anthropic API",
        detail: errText,
      }, 502);
    }

    const anthropicData = await anthropicResp.json();
    const textBlock = (anthropicData.content || []).find(
      (b: any) => b.type === "text",
    );

    let insights: any[] = [];
    try {
      const cleaned = (textBlock?.text || "[]")
        .replace(/```json|```/g, "")
        .trim();
      insights = JSON.parse(cleaned);
      if (!Array.isArray(insights)) insights = [insights];
    } catch (_e) {
      // Kalau Claude tidak balas JSON murni (jarang terjadi, tapi jaga-jaga), tetap tampilkan
      // teksnya apa adanya sebagai satu insight, daripada gagal total.
      insights = [{
        title: "Analisis Claude",
        message: textBlock?.text || "Tidak ada respons dari Claude.",
        severity: "info",
      }];
    }

    return jsonResponse({ insights });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
