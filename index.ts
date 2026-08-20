// supabase/functions/analyze-finance/index.ts
//
// Edge Function untuk EMPAT fitur di MyFinance yang sama-sama butuh Gemini AI.
// API key Gemini dan rate-limit state tetap berada di server.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGemini(promptText: string) {
  const resp = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY!,
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Response(JSON.stringify({ error: "Gagal memanggil Gemini API", detail: errText }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await resp.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: "GEMINI_API_KEY belum diset di Supabase secrets." }, 500);
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY belum tersedia di Edge Function." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    // User-scoped client: HANYA untuk memvalidasi JWT. RLS tetap berlaku di client ini.
    const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    // Service-role client: hanya dipakai untuk state rate-limit internal. Tidak pernah dikirim
    // ke browser dan tidak boleh dipakai untuk operasi data keuangan user.
    const admin = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { question, mode, ...summary } = body || {};

    if (mode === "suggest_category") {
      const keterangan = String(body?.keterangan || "").slice(0, 200);
      const jenis = body?.jenis === "Pemasukan" ? "Pemasukan" : "Pengeluaran";
      const categories: string[] = Array.isArray(body?.categories) ? body.categories.slice(0, 100) : [];
      if (!keterangan || categories.length === 0) return jsonResponse({ kategori: null });

      const catPrompt =
        `User sedang mencatat transaksi ${jenis} di aplikasi pencatatan keuangan, dengan keterangan: "${keterangan}". ` +
        `Dari daftar kategori berikut (HARUS PERSIS SAMA PENULISANNYA, case-sensitive, JANGAN membuat nama baru): ` +
        `[${categories.join(", ")}]\n` +
        `Pilih SATU kategori yang PALING cocok. Kalau tidak ada satupun yang cukup relevan/yakin, balas null. ` +
        `Balas HANYA JSON valid, tanpa markdown/backtick/teks lain, format persis: {"kategori": string atau null}`;

      let rawText: string;
      try { rawText = await callGemini(catPrompt); }
      catch (errResp) { if (errResp instanceof Response) return errResp; throw errResp; }

      try {
        const parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
        const kategori = parsed?.kategori && categories.includes(parsed.kategori) ? parsed.kategori : null;
        return jsonResponse({ kategori });
      } catch (_e) {
        return jsonResponse({ kategori: null });
      }
    }

    const commonContext =
      `Kamu asisten analisis keuangan pribadi untuk aplikasi pencatatan keuangan Indonesia (mata uang Rupiah/IDR). ` +
      `Berikut ringkasan keuangan user BULAN BERJALAN ini:\n\n${JSON.stringify(summary, null, 2)}\n\n`;

    if (mode === "monthly_summary") {
      const summaryPrompt = commonContext +
        `Tulis SATU paragraf ringkasan laporan keuangan BULAN LALU (pakai field pemasukan_bulan_lalu & pengeluaran_bulan_lalu ` +
        `sebagai fokus utama), dalam Bahasa Indonesia, nada suportif dan mudah dibaca orang awam, maksimal 4-5 kalimat. ` +
        `Sebutkan angka pemasukan & pengeluaran bulan lalu, bandingkan tren jika datanya tersedia, dan sebut 1 kategori ` +
        `pengeluaran terbesar kalau relevan. HANYA berdasarkan angka pada ringkasan. Jangan mengarang. ` +
        `Balas HANYA teks paragrafnya saja.`;
      let summaryText: string;
      try { summaryText = await callGemini(summaryPrompt); }
      catch (errResp) { if (errResp instanceof Response) return errResp; throw errResp; }
      return jsonResponse({ summary: summaryText.trim() || "Belum ada ringkasan." });
    }

    if (question && String(question).trim()) {
      const MIN_GAP_MS = 8000;
      const { data: rl } = await admin
        .from("rate_limits")
        .select("last_ai_chat_at")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (rl?.last_ai_chat_at) {
        const elapsed = Date.now() - new Date(rl.last_ai_chat_at).getTime();
        if (elapsed < MIN_GAP_MS) {
          const waitSec = Math.ceil((MIN_GAP_MS - elapsed) / 1000);
          return jsonResponse({ error: `Tunggu ${waitSec} detik lagi sebelum kirim pesan berikutnya ya.` }, 429);
        }
      }

      const qaPrompt = commonContext +
        `User bertanya: "${String(question).trim()}"\n\n` +
        `Jawab dalam Bahasa Indonesia, singkat (maksimal 3-4 kalimat), HANYA berdasarkan angka pada ringkasan. ` +
        `Kalau datanya tidak cukup, katakan dengan jujur dan jangan mengarang. Balas HANYA teks jawabannya.`;

      let answerText: string;
      try { answerText = await callGemini(qaPrompt); }
      catch (errResp) { if (errResp instanceof Response) return errResp; throw errResp; }

      // Rate-limit state sekarang TIDAK dapat dimanipulasi browser karena write dilakukan dengan
      // service-role client di server. Hanya panggilan Gemini yang berhasil yang menyentuh timestamp.
      const { error: rlWriteErr } = await admin.from("rate_limits").upsert({
        user_id: userData.user.id,
        last_ai_chat_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (rlWriteErr) console.error("Gagal menyimpan AI rate-limit state:", rlWriteErr);

      return jsonResponse({ answer: answerText.trim() || "Maaf, tidak ada jawaban." });
    }

    const prompt = commonContext +
      `Berikan MAKSIMAL 3 rekomendasi/insight yang KONKRET, SPESIFIK, dan actionable dalam Bahasa Indonesia, ` +
      `HANYA berdasarkan angka pada data di atas. Kalau datanya terlalu sedikit/kosong, cukup kasih 1 insight umum. ` +
      `Balas HANYA JSON array valid, format: ` +
      `[{"title":"judul singkat","message":"penjelasan 1-2 kalimat","severity":"info"|"warning"|"success"}]`;

    let rawText: string;
    try { rawText = await callGemini(prompt); }
    catch (errResp) { if (errResp instanceof Response) return errResp; throw errResp; }

    let insights: any[] = [];
    try {
      insights = JSON.parse((rawText || "[]").replace(/```json|```/g, "").trim());
      if (!Array.isArray(insights)) insights = [insights];
    } catch (_e) {
      insights = [{ title: "Analisis Gemini", message: rawText || "Tidak ada respons dari Gemini.", severity: "info" }];
    }

    return jsonResponse({ insights });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
