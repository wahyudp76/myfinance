// supabase/functions/smooth-processor/index.ts
//
// DEPRECATED -- lihat commit riwayat Phase 7 (branch refactor/supabase-native-foundation,
// project MyFinance Dashboard).
//
// Function ini dulunya versi LAMA dari "analyze-finance" (pakai Anthropic Claude API, cuma 2
// dari 4 mode yang sekarang ada). Sudah digantikan sepenuhnya oleh function `analyze-finance`
// yang aktif sekarang (pakai Gemini, 4 mode lengkap, sudah ada rate limiting server-side).
// Dikonfirmasi lewat grep menyeluruh ke index.html & seluruh Edge Function lain: TIDAK ADA
// satu pun kode yang memanggil "smooth-processor" -- murni sisa yang tertinggal, kemungkinan
// dari eksperimen migrasi provider AI yang tidak dilanjutkan.
//
// KENAPA TIDAK LANGSUNG DIHAPUS? Tool akses Supabase yang dipakai sesi ini cuma bisa
// create/update/baca/list Edge Function -- tidak ada kemampuan hapus. Jadi function ini
// DINONAKTIFKAN dulu lewat stub ini (tidak lagi memanggil Anthropic API sama sekali, jadi
// tidak ada lagi risiko biaya/penyalahgunaan kalau ada yang menemukan endpoint-nya), sambil
// menunggu dihapus permanen secara manual:
//
//   supabase functions delete smooth-processor
//
// (atau lewat Dashboard: Edge Functions -> smooth-processor -> tombol Delete)
//
// Setelah dihapus permanen, secret ANTHROPIC_API_KEY (yang tampaknya cuma dipakai function ini
// -- tidak ditemukan di analyze-finance/scan-receipt/get-exchange-rate/refresh-asset-price/
// whatsapp-webhook manapun) kemungkinan juga aman dihapus lewat:
//
//   supabase secrets unset ANTHROPIC_API_KEY
//
// (cek dulu lewat `supabase secrets list` & pastikan memang tidak ada Edge Function lain yang
// masih memakainya sebelum unset, untuk jaga-jaga.)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "Function ini sudah tidak dipakai (deprecated), digantikan oleh 'analyze-finance'. Tidak ada aksi yang dilakukan.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
