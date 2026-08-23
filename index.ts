// supabase/functions/scan-receipt/index.ts
//
// Edge Function untuk fitur "Struk Scanner" -- tombol kamera di modal Catat Transaksi.
// Beda dari analyze-finance (yang cuma kirim TEKS ringkasan angka): function ini kirim GAMBAR
// (foto struk, base64) ke Gemini pakai kemampuan vision-nya, minta di-"baca" jadi data transaksi
// terstruktur (nama toko, total, tanggal, kategori). Sama seperti analyze-finance, WAJIB lewat
// Edge Function supaya GEMINI_API_KEY tidak pernah sampai ke browser.
//
// PAKAI SECRET YANG SAMA seperti analyze-finance (GEMINI_API_KEY) -- kalau itu sudah di-set,
// TIDAK perlu supabase secrets set lagi buat function ini.
//
// CARA DEPLOY:
//   supabase functions deploy scan-receipt

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// Sengaja pakai model yang sama dengan analyze-finance supaya konsisten -- lihat catatan di file
// itu soal nama model ini (cek https://ai.google.dev/gemini-api/docs/models kalau ternyata sudah
// tidak berlaku). Model "flash" dipilih karena tugas baca struk itu straightforward (bukan
// reasoning berat), dan supaya biaya per-scan tetap murah.
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// Batas ukuran base64 gambar yang diterima (~6MB) -- client SEHARUSNYA sudah mengompres ke jauh
// di bawah ini (lihat compressImageDataUrl di index.html, maks 1600px & JPEG 85%), ini cuma jaga2
// di sisi server supaya tidak ada payload raksasa yang lolos & bikin boros kuota Gemini.
const MAX_BASE64_LENGTH = 8_000_000;

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
  if (!GEMINI_API_KEY) {
    return jsonResponse({
      error: "GEMINI_API_KEY belum diset di Supabase secrets. Jalankan: supabase secrets set GEMINI_API_KEY=AIzaSy-xxxx",
    }, 500);
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
    const imageBase64: string | undefined = body?.image_base64;
    const mimeType: string = body?.mime_type || "image/jpeg";
    const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return jsonResponse({ error: "image_base64 wajib dikirim." }, 400);
    }
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "Ukuran foto terlalu besar. Coba foto lain atau kompres dulu." }, 400);
    }

    const categoryListText = categories.length > 0
      ? categories.join(", ")
      : "(user belum punya kategori pengeluaran kustom, boleh dikosongkan)";

    const promptText =
      `Ini foto struk/kuitansi belanja. Tugasmu membaca isinya dan mengekstrak data transaksi. ` +
      `Balas HANYA dalam bentuk JSON valid (tanpa markdown, tanpa backtick, tanpa teks lain di luar JSON), ` +
      `dengan format persis:\n` +
      `{"is_receipt": boolean, "merchant": string atau null, "total": number atau null, "tanggal": string (format YYYY-MM-DD) atau null, "kategori": string atau null}\n\n` +
      `Aturan:\n` +
      `- "is_receipt": false kalau gambar ini JELAS BUKAN struk/kuitansi belanja (misal foto orang, pemandangan, dokumen lain). Kalau false, field lain boleh null semua.\n` +
      `- "merchant": nama toko/merchant/warung di struk itu, seringkas mungkin (2-4 kata).\n` +
      `- "total": TOTAL akhir yang harus dibayar (bukan subtotal sebelum pajak/diskon kalau ada total akhir yang lebih jelas), sebagai angka murni tanpa "Rp"/titik/koma pemisah ribuan.\n` +
      `- "tanggal": tanggal transaksi di struk itu kalau terlihat jelas, format YYYY-MM-DD. Kalau tidak ada/tidak jelas, null (JANGAN menebak/mengarang tanggal hari ini).\n` +
      `- "kategori": pilih SATU yang PALING cocok dari daftar kategori berikut, HARUS PERSIS SAMA PENULISANNYA (case-sensitive) dengan salah satu di daftar ini, JANGAN membuat nama kategori baru: [${categoryListText}]. Kalau tidak ada satupun yang cocok, atau daftar kategorinya kosong, isi null.\n` +
      `- Kalau ada bagian yang tidak yakin/tidak terbaca jelas, lebih baik null daripada menebak/mengarang.`;

    const resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return jsonResponse({ error: "Gagal memanggil Gemini API", detail: errText }, 502);
    }

    const geminiData = await resp.json();
    const rawText = String(geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");

    let parsed: any;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (_e) {
      return jsonResponse({
        error: "Gagal membaca respons AI. Coba foto ulang dengan pencahayaan lebih jelas.",
      }, 502);
    }

    if (parsed?.is_receipt === false) {
      return jsonResponse({
        error: "Foto ini kelihatannya bukan struk belanja. Coba foto struk yang jelas.",
      }, 400);
    }

    return jsonResponse({
      merchant: parsed?.merchant ?? null,
      total: typeof parsed?.total === "number" ? parsed.total : null,
      tanggal: parsed?.tanggal ?? null,
      kategori: parsed?.kategori ?? null,
    });
  } catch (e) {
    return jsonResponse({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
