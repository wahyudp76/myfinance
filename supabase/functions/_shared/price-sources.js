// supabase/functions/_shared/price-sources.js
//
// Helper murni (tanpa network/DOM) utk sumber harga pasar Edge Function
// refresh-asset-price. Dipisah supaya bisa diuji unit tanpa Deno/network.
//
// Status sumber (uji live 2026-09-01):
//  - Yahoo Finance chart API: query1 & query2 dua-duanya hidup; dipakai sbg
//    mirror berurutan utk saham IDX (ticker 4 huruf + ".JK").
//  - Stooq: MATI (jangan dipakai).
//  - Proxy CORS publik: semua mati/berbayar (jangan dipakai).

/** Normalisasi kode saham IDX: huruf besar + akhiran ".JK" (idempoten). */
export function normalizeIdxTicker(code) {
  const v = String(code ?? "").trim().toUpperCase();
  if (!v) return "";
  return v.endsWith(".JK") ? v : v + ".JK";
}

/**
 * URL chart Yahoo utk sebuah kode IDX, dua mirror berurutan (query1 dulu,
 * lalu query2). Caller wajib mencoba keduanya sebelum menyerah.
 */
export function yahooChartUrls(code) {
  const ticker = normalizeIdxTicker(code);
  if (!ticker) return [];
  const enc = encodeURIComponent(ticker);
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${enc}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${enc}`,
  ];
}

/**
 * Ekstraksi harga pasar dari payload chart Yahoo v8.
 * Mengembalikan { price, timeIso } hanya bila harganya angka positif;
 * selain itu null (payload kosong/rusak/aneh TIDAK boleh lolos sbg angka).
 */
export function pickYahooMarketPrice(payload) {
  const meta = payload?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !isFinite(price) || price <= 0) return null;
  const t = meta?.regularMarketTime;
  const timeIso =
    typeof t === "number" && isFinite(t) ? new Date(t * 1000).toISOString() : null;
  return { price, timeIso };
}

/** Pesan gagal yg ramah: sebut kode, sarankan jalur manual. */
export function yahooFailureMessage(kodeSaham) {
  return (
    `Sumber harga saham (Yahoo Finance) sedang tidak bisa dihubungi utk "${kodeSaham}" ` +
    `(kedua mirror gagal). Coba lagi beberapa saat, atau pakai Sync Manual di detail aset.`
  );
}
