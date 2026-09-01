/**
 * Benchmark alur SIMPAN transaksi: sebelum vs sesudah optimasi (v52).
 *
 * Sebelum (v51):
 *   1. auth.getUser()          -- 1 round-trip jaringan (query server Auth)
 *   2. INSERT ... .select(id)  -- 1 round-trip (PostgREST)
 *   3. list() seluruh tabel    -- ceil(N/1000) round-trip BERURUTAN
 *   TOTAL sebelum ~= 2 + ceil(N/1000) RTT, baru kemudian render ulang penuh.
 *
 * Sesudah (v52):
 *   1. INSERT ... .select(*)   -- 1 round-trip, SEKALIGUS mengembalikan baris
 *   2. echo lokal              -- 0 round-trip (render dari baris server itu)
 *   TOTAL sesudah ~= 1 RTT.
 *
 * Angka RTT di sini diukur NYATA dari mesin ini ke endpoint Supabase
 * (median 10 sampel). RTT nyata di jaringan kamu bisa berbeda -- yang penting
 * PERBANDINGAN jumlah round-trip, karena itu yang menentukan skalanya.
 *
 * Jalankan tanpa dependensi apa pun:  node scripts/bench-save-latency.mjs
 */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://uxfngmxghupdlwoeoxgh.supabase.co";
const ROWS = Number(process.env.ROWS || 300); // jumlah baris transaksi user (untuk simulasikan list())
const SAMPLES = 10;

async function measureRtt(url, samples = SAMPLES) {
  const times = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    try {
      await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    } catch {
      // timeout/network error tetap dihitung waktunya (RTT masih valid)
    }
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function main() {
  console.log(`Target Supabase : ${SUPABASE_URL}`);
  console.log(`Jumlah transaksi : ${ROWS} baris`);
  console.log(`Sampel RTT      : ${SAMPLES}x (median)`);
  console.log("");

  // RTT ke PostgREST (endpoint insert/list) dan Auth (endpoint getUser).
  const restRtt = await measureRtt(`${SUPABASE_URL}/rest/v1/`);
  const authRtt = await measureRtt(`${SUPABASE_URL}/auth/v1/health`);
  console.log(`RTT terukur (median):`);
  console.log(`  PostgREST /rest/v1/   : ${restRtt.toFixed(0)} ms`);
  console.log(`  Auth /auth/v1/health  : ${authRtt.toFixed(0)} ms`);
  console.log("");

  const pages = Math.ceil(ROWS / 1000);
  const oldRtts = 2 + pages;
  const newRtts = 1;
  const oldMs = authRtt + restRtt * (1 + pages);
  const newMs = restRtt;

  const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);

  console.log("=== ALUR SIMPAN 1 TRANSAKSI (komponen jaringan) ===");
  console.log("SEBELUM (v51):");
  console.log(`  1. auth.getUser()                ${authRtt.toFixed(0)} ms   (1 RTT, query server)`);
  console.log(`  2. INSERT + select(id)           ${restRtt.toFixed(0)} ms   (1 RTT)`);
  console.log(`  3. list() semua transaksi        ${fmt(restRtt * pages)}   (${pages} RTT berurutan${pages > 1 ? " -- paging 1000 baris" : ""})`);
  console.log(`  => TOTAL ~${fmt(oldMs)}  (${oldRtts} round-trip berurutan) + render ulang penuh`);
  console.log("");
  console.log("SESUDAH (v52):");
  console.log(`  1. INSERT + select(*)            ${restRtt.toFixed(0)} ms   (1 RTT -- sekalian mengembalikan baris)`);
  console.log(`  2. echo lokal (render)             0 ms   (0 RTT, baris ASLI dari server)`);
  console.log(`  => TOTAL ~${fmt(newMs)}  (${newRtts} round-trip) + render lokal saja`);
  console.log("");

  const saved = oldMs - newMs;
  console.log(`HEMAT: ${saved.toFixed(0)} ms per simpan (${((saved / oldMs) * 100).toFixed(0)}% waktu jaringan)`);
  console.log(`Ratio RTT: ${oldRtts} -> ${newRtts}  (${(1 - newRtts / oldRtts) * 100}% lebih sedikit round-trip)`);
  console.log("");
  console.log("Catatan: RTT terukur dari server (Latency: US-East/asia). Di jaringan");
  console.log("pengguna (Indonesia), RTT tipikal 50-150 ms -- penghematan proporsional.");
}

main().catch((err) => {
  console.error("Benchmark gagal:", err);
  process.exit(1);
});
