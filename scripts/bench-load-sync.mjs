// BENCH LOAD & SYNC — angka nyata untuk jalur "muat data" & "sinkronisasi".
//
// KENAPA HARNESS INI ADA (v127):
// Perbaikan performa di repo ini selama ini diklaim lewat angka profil manual di
// komentar (mis. catatan v114: "render dashboard ~270ms pada 2.500 transaksi dgn
// CPU 4x throttle"). Tidak ada satu pun alat yang bisa MENJAWAB pertanyaan
// "apakah perubahan ini benar-benar lebih cepat, dan berapa?" secara berulang.
// Harness ini menutup lubang itu: ia memuat aplikasi SUNGGUHAN (index.html +
// app.js + boot.bundle.js) di Chromium sungguhan dengan backend Supabase yang
// di-STUB (tanpa rahasia, tanpa kuota, tanpa jaringan luar), lalu mengukur:
//
//   1. BOOT      : navigasi -> appShell tampil -> data cloud ter-commit.
//   2. SYNC      : satu loadData() penuh (jalur pull-to-refresh / buka app).
//   3. CRUD-SYNC : refreshTransactionsOnly() (jalur setelah simpan/edit/hapus).
//   4. RENDER    : biaya fungsi render besar (filterTransactions,
//                  processDataForUI, renderRecentList) di dalam halaman.
//   5. JARINGAN  : jumlah request REST per tabel + byte payload transaksi.
//
// Service worker SENGAJA dimatikan (serviceWorkers: "block") supaya angka tidak
// tercemar cache antar-run, dan CPU di-throttle 4x (Emulation.setCPUThrottlingRate)
// supaya mencerminkan ponsel kelas menengah — konvensi yang sama dipakai catatan
// profil v114. Latensi jaringan stub dapat diatur lewat env BENCH_LATENCY_MS
// (default 0 = isolasi biaya CPU/JS; naikkan untuk melihat sensitivitas jaringan).
//
// Jalankan:  node scripts/bench-load-sync.mjs
//   env: BENCH_URL       (default: server statis internal di port acak)
//        BENCH_ROWS      (default 2500 baris transaksi)
//        BENCH_LATENCY_MS(default 0)
//        BENCH_CPU       (default 4; 1 = tanpa throttle)
//        BENCH_REPEAT    (default 3; jumlah pengulangan utk median)
//        BENCH_JSON      (opsional: tulis hasil mentah ke path ini)
//
// Harness ini TIDAK dipasang di CI: angka waktunya bergantung mesin, jadi
// menjadikannya gate hanya akan melahirkan tes flaky. Fungsinya alat ukur lokal
// (sama seperti scripts/bench-save-latency.mjs) — jalankan sebelum & sesudah
// perubahan, lalu catat selisihnya di AGENT-HANDOFF.md.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const ROWS = Number(process.env.BENCH_ROWS || 2500);
const LATENCY = Number(process.env.BENCH_LATENCY_MS || 0);
const CPU = Number(process.env.BENCH_CPU || 4);
const REPEAT = Number(process.env.BENCH_REPEAT || 3);
const REF = "uxfngmxghupdlwoeoxgh";
const UID = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------------------
// Server statis minimal (cukup untuk harness; CI tetap pakai python3 -m http.server)
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".map": "application/json",
};
async function startStaticServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^([/\\])+/, "");
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
    try {
      const st = await stat(file);
      const target = st.isDirectory() ? join(file, "index.html") : file;
      const body = await readFile(target);
      res.writeHead(200, { "Content-Type": MIME[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

// ---------------------------------------------------------------------------
// Data seed: bentuk baris PERSIS seperti yang dikembalikan PostgREST untuk
// kolom yang dipilih TX_SELECT (src/services/transactions.js) — jumlah datang
// sebagai string numeric, sama seperti numeric Postgres lewat PostgREST.
// ---------------------------------------------------------------------------
const KATEGORI = ["Makanan", "Transportasi", "Belanja", "Tagihan", "Hiburan", "Gaji", "Kesehatan"];
const AKUN = ["BCA", "GoPay", "OVO", "Mandiri"];
function hari(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TX = Array.from({ length: ROWS }, (_, i) => {
  const offsetHari = Math.floor((i * 730) / ROWS); // tersebar merata ~2 tahun
  return {
    id: `10000000-0000-4000-8000-${String(ROWS - i).padStart(12, "0")}`,
    user_id: UID,
    jenis: i % 7 === 0 ? "Pemasukan" : (i % 11 === 0 ? "Transfer" : "Pengeluaran"),
    tanggal: hari(offsetHari),
    jumlah: String(15000 + ((i * 7919) % 480000)),
    akun: AKUN[i % AKUN.length],
    kategori: KATEGORI[i % KATEGORI.length],
    keterangan: `transaksi contoh ${i}`,
    mata_uang: "IDR",
    kurs: "1",
    jumlah_idr: String(15000 + ((i * 7919) % 480000)),
    created_at: `${hari(offsetHari)}T${String(8 + (i % 12)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    transfer_jumlah_tujuan: null, transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null, transfer_jumlah_tujuan_idr: null,
  };
});
const ASET = [{
  id: "a1", nama: "Saham ABCD", kategori: "Saham", platform: "Stockbit", modal: "1000000",
  nilai: "1250000", jumlah_unit: "100", terakhir: new Date().toISOString(), simbol: null,
  sumber_harga: null, tanggal_nav: null, user_id: UID,
  value_history: [{ tanggal: hari(5), nilai: 1100000 }, { tanggal: hari(0), nilai: 1250000 }],
}];
const BUDGETS = [{ kategori: "Makanan", jumlah: "1000000" }, { kategori: "Transportasi", jumlah: "500000" }];
const RECURRING = [{
  id: "r1", jenis: "Pengeluaran", jumlah: "50000", akun: "BCA", kategori: "Tagihan",
  keterangan: "Langganan", frequency: "monthly", start_date: hari(30),
  next_due_date: hari(-20), end_date: null, active: true, // sengaja BELUM jatuh tempo: catch-up otomatis bukan yang diukur di sini
}];
const SETTINGS = [{ data: {
  accounts: AKUN, accountIcons: {}, account_currencies: {}, themeColor: null,
  custom_categories: { pengeluaran: { parents: [], subs: {} }, pemasukan: { parents: [], subs: {} } },
  hidden_categories: { pengeluaran: [], pemasukan: [] }, financial_goals: [], debts: [],
} }];
const SESSION = {
  access_token: "stub", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
  user: { id: UID, aud: "authenticated", email: "bench@local.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

// Statistik jaringan yang dikumpulkan dari sisi stub.
const net = { perTabel: {}, totalBytes: 0, urutanBoot: [] };
function catat(tabel, bytes, fase) {
  const e = (net.perTabel[tabel] ||= { request: 0, bytes: 0 });
  e.request += 1; e.bytes += bytes; net.totalBytes += bytes;
  if (fase === "boot") net.urutanBoot.push(tabel);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const internal = process.env.BENCH_URL ? null : await startStaticServer();
  const URL_ = process.env.BENCH_URL || internal.url;
  console.log(`Target app   : ${URL_}`);
  console.log(`Baris tx     : ${ROWS} | latensi stub: ${LATENCY} ms | CPU throttle: ${CPU}x | repeat: ${REPEAT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // ponsel: jalur render yang paling mahal
    serviceWorkers: "block", // angka tidak boleh tercemar cache SW antar-run
  });
  await context.addInitScript(([r, s]) => {
    const k = `sb-${r}-auth-token`;
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s));
  }, [REF, SESSION]);

  // Fase jaringan: "boot" sampai data pertama ter-commit, setelah itu "sync".
  let fase = "boot";

  // PENTING: respons lintas-origin hanya membolehkan header yang disebut di
  // Access-Control-Expose-Headers dibaca JS. Supabase produksi mengirimnya; tanpa
  // itu supabase-js tidak melihat Content-Range -> count = null -> fetchAllRows
  // memakai fallback loop BERURUTAN (bukan jalur paralel 2-fase yang diukur).
  const CORS_HEADERS = { "Access-Control-Expose-Headers": "Content-Range, X-Request-Id" };
  const json = (b, status = 200, headers = {}) => ({
    status, contentType: "application/json", headers: { ...CORS_HEADERS, ...headers }, body: JSON.stringify(b),
  });

  // GET /rest/v1/transactions meniru paging PostgREST. supabase-js 2.113 mengirim
  // halaman sebagai QUERY PARAM `offset` & `limit` (bukan header Range), dan total
  // baris kembali di header Content-Range "from-to/total" -- itulah yang dibaca
  // fetchAllRows (src/services/supabase/paging.js) untuk menghitung sisa halaman
  // setelah request pertama ber-`Prefer: count=exact`.
  await context.route("**/rest/v1/transactions**", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") { await sleep(LATENCY); catat("transactions(w)", 0, fase); return route.fulfill(json(TX[0], 201)); }
    const q = new URL(req.url()).searchParams;
    const from = Number(q.get("offset") || 0);
    const to = from + Number(q.get("limit") || 1000) - 1;
    const slice = TX.slice(from, to + 1);
    const body = JSON.stringify(slice);
    await sleep(LATENCY);
    catat("transactions", Buffer.byteLength(body), fase);
    return route.fulfill(json(slice, 200, { "Content-Range": `${from}-${from + slice.length - 1}/${TX.length}` }));
  });
  const tabelSederhana = {
    assets: ASET, budgets: BUDGETS, recurring_transactions: RECURRING,
    settings: SETTINGS, custom_icons: [], platform_logos: [],
  };
  for (const [tabel, isi] of Object.entries(tabelSederhana)) {
    await context.route(`**/rest/v1/${tabel}**`, async (route) => {
      const req = route.request();
      await sleep(LATENCY);
      if (req.method() !== "GET") { catat(`${tabel}(w)`, 0, fase); return route.fulfill(json({}, 201)); }
      const body = JSON.stringify(isi);
      catat(tabel, Buffer.byteLength(body), fase);
      return route.fulfill(json(isi));
    });
  }
  await context.route("**/rest/v1/rpc/**", async (route) => { await sleep(LATENCY); catat("rpc", 0, fase); return route.fulfill(json({ ok: true }, 200)); });
  await context.route("**/functions/v1/**", async (route) => { await sleep(LATENCY); return route.fulfill(json({ ok: true })); });
  await context.route("**/auth/v1/**", async (route) => { await sleep(LATENCY); return route.fulfill(json(SESSION)); });

  const page = await context.newPage();
  // v131: saksi "kapan shell BENAR-BENAR terlihat". `waitForSelector` di bawah
  // hanya bisa melaporkan saat polling-nya sempat jalan -- padahal main thread
  // sedang sibuk menjalankan initApp/render, jadi angkanya bisa tertinggal
  // ~1 detik dari momen pengguna benar-benar melihat shell. Probe ini dipasang
  // SEBELUM skrip halaman (addInitScript), mengamati class #appShell, lalu
  // mencatat performance.now() pada frame pertama setelah 'hidden' dilepas
  // (callback rAF berjalan tepat sebelum paint frame itu).
  await page.addInitScript(() => {
    window.__shellPaintMs = null;
    const mo = new MutationObserver(() => {
      const el = document.getElementById("appShell");
      if (el && !el.classList.contains("hidden") && window.__shellPaintMs === null) {
        requestAnimationFrame(() => {
          if (window.__shellPaintMs === null) window.__shellPaintMs = performance.now();
        });
        mo.disconnect();
      }
    });
    const mulai = () => {
      const el = document.getElementById("appShell");
      if (el) mo.observe(el, { attributes: true, attributeFilter: ["class"] });
      else setTimeout(mulai, 5);
    };
    mulai();
  });
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  // ---- 1. BOOT -------------------------------------------------------------
  const tNav = Date.now();
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#appShell:not(.hidden)", { timeout: 60000 });
  const tShell = Date.now() - tNav;
  const tPaint = await page.evaluate(() => window.__shellPaintMs);
  await page.waitForFunction(() => typeof globalData !== "undefined" && Array.isArray(globalData) && globalData.length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.body.dataset.syncLoading, null, { timeout: 60000 });
  const tData = Date.now() - tNav;
  const bootRows = await page.evaluate(() => globalData.length);
  const bootNet = JSON.parse(JSON.stringify(net));
  fase = "sync";

  // ---- 2. SYNC penuh (loadData) & 3. CRUD-SYNC (refreshTransactionsOnly) ----
  const measureInPage = async (expr) => {
    const samples = [];
    for (let i = 0; i < REPEAT; i += 1) {
      samples.push(await page.evaluate(async (src) => {
        const t0 = performance.now();
        // Harness: mengeksekusi ekspresi app (mis. "filterTransactions()") di
        // konteks halaman -- satu-satunya cara mengukur biaya fungsi global app
        // tanpa menyuntikkan pencatat waktu ke dalam app.js sendiri.
        await eval(src);
        return performance.now() - t0;
      }, expr));
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };
  // loadData() & refreshTransactionsOnly() tidak mengembalikan Promise yang
  // bisa di-await pemanggil, jadi selesai-nya dideteksi lewat status overlay.
  const awaitSyncDone = () => page.waitForFunction(
    () => !document.body.dataset.syncLoading
      && (document.getElementById("loading").style.display === "none" || document.getElementById("loading").style.display === ""),
    null, { timeout: 60000 },
  );
  const syncSamples = [];
  for (let i = 0; i < REPEAT; i += 1) {
    const t0 = Date.now();
    await page.evaluate(() => loadData());
    await awaitSyncDone();
    syncSamples.push(Date.now() - t0);
  }
  // v130: snapshot jaringan DIPISAH per fase. Sebelumnya satu snapshot diambil
  // SETELAH loop sync DAN loop CRUD, lalu selisihnya dilabeli "saat 1 sync
  // penuh" -- padahal isinya gabungan keduanya dikalikan REPEAT. Angka itu
  // sempat terbaca sebagai "satu loadData() menarik transactions 2x" (2 request
  // identik pada REPEAT=1); setelah URL request-nya dicetak, terbukti yang satu
  // lagi adalah refreshTransactionsOnly() dari loop CRUD. Bukan pemborosan --
  // labelnya yang menyesatkan.
  const netSesudahSync = JSON.parse(JSON.stringify(net));
  const crudSamples = [];
  for (let i = 0; i < REPEAT; i += 1) {
    const t0 = Date.now();
    await page.evaluate(() => refreshTransactionsOnly());
    await awaitSyncDone();
    crudSamples.push(Date.now() - t0);
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const syncNet = JSON.parse(JSON.stringify(net));

  // ---- 4. RENDER (biaya fungsi besar, diukur di dalam halaman) -------------
  await page.evaluate(() => switchView("transaksi"));
  await page.waitForTimeout(400);
  const renderTx = await measureInPage("filterTransactions()");
  await page.evaluate(() => switchView("dashboard"));
  await page.waitForTimeout(400);
  const renderDash = await measureInPage("processDataForUI(globalData, true)");
  const renderRecent = await measureInPage("renderRecentList(globalData)");
  // Biaya sortir khusus: pembanding txServerCompare dipanggil O(n log n) kali.
  const sortCost = await measureInPage(`(() => { const d = [...globalData]; d.sort(txServerCompare); })()`);

  // ---- 5. PROFIL (opsional, BENCH_PROFILE=1) --------------------------------
  // Membungkus fungsi global app dengan pencatat waktu, lalu menjalankan SATU
  // loadData() penuh: menjawab "dari 600-an ms itu, habis di fungsi yang mana?"
  // Senjata untuk memastikan optimasi menyasar biaya terbesar, bukan dugaan.
  let profil = null;
  if (process.env.BENCH_PROFILE) {
    await page.evaluate(() => {
      window.__prof = {};
      const bungkus = (owner, name) => {
        const asli = owner[name];
        if (typeof asli !== "function") return;
        owner[name] = function (...args) {
          const t0 = performance.now();
          try { return asli.apply(this, args); } finally {
            const e = (window.__prof[name] ||= { calls: 0, ms: 0 });
            e.calls += 1; e.ms += performance.now() - t0;
          }
        };
      };
      ["filterTransactions", "processDataForUI", "renderRecentList", "renderSettings",
        "updateFormOptions", "renderInsights", "renderHealthScore", "renderReportTab",
        "renderRecurringSummary", "updateDashboardEmptyState", "renderHudSparklines",
        "renderAccountList", "rebuildCategoryDict", "animateRupiah", "renderBudgetView",
        "renderAssetView", "renderCalendar", "applyThemeColor", "updateUserIdentity",
        "renderAssetCards", "applyDefaultViewOnce", "switchView", "updateDashboardCards",
      ].forEach((n) => bungkus(window, n));
      const svc = window.__myfinanceServices || {};
      ["aggregateDashboardData", "buildInsightsContext", "syncAccountsFromTransactions",
        "reconcileTxRowsWithPending", "computeFinancialInsights", "computeFinancialHealthScore",
        "computeYearlySummary", "computeCalendarMonthSummary",
      ].forEach((n) => bungkus(svc, n));
    });
    const t0 = Date.now();
    await page.evaluate(() => loadData());
    await awaitSyncDone();
    const totalMs = Date.now() - t0;
    const mentah = await page.evaluate(() => window.__prof);
    profil = { totalMs, fungsi: Object.entries(mentah)
      .map(([nama, v]) => ({ nama, calls: v.calls, ms: Math.round(v.ms * 10) / 10 }))
      .sort((a, b) => b.ms - a.ms).filter((f) => f.ms >= 1) };
    console.log(`\n=== PROFIL 1x loadData() penuh (total ${totalMs} ms) ===`);
    for (const f of profil.fungsi.slice(0, 18)) {
      console.log(`  ${f.nama.padEnd(30)} ${String(f.calls).padStart(2)}x  ${String(f.ms).padStart(7)} ms  (${((f.ms / totalMs) * 100).toFixed(0)}%)`);
    }
  }

  // ---- 6. MICRO A/B (BENCH_MICRO=1) -----------------------------------------
  // Angka end-to-end di atas bising (parse innerHTML + GC), jadi klaim untuk dua
  // perubahan spesifik diukur TERISOLASI di sini dengan banyak pengulangan:
  //   (a) sortTxRows vs [...rows].sort()  -- termasuk bukti hasil IDENTIK
  //   (b) animateRupiah textContent vs innerText pada elemen dashboard sungguhan
  let micro = null;
  if (process.env.BENCH_MICRO) {
    micro = await page.evaluate(() => {
      const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const ukur = (fn, ulang = 7) => { const s = []; for (let i = 0; i < ulang; i += 1) { const t = performance.now(); fn(); s.push(performance.now() - t); } return Math.round(median(s) * 10) / 10; };
      const hari = (o) => { const d = new Date(); d.setDate(d.getDate() - o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      // Baris sintetis berbentuk sama dengan hasil list(), SUDAH terurut server
      // (tanggal DESC, created_at DESC, id ASC) -- persis kondisi nyata.
      const bikin = (n) => Array.from({ length: n }, (_, i) => {
        const off = Math.floor((i * 730) / n);
        return { id: `id-${String(n - i).padStart(8, "0")}`, tanggal: hari(off), created_at: `${hari(off)}T${String(23 - (i % 24)).padStart(2, "0")}:00:00Z`, jumlah: 1000 };
      });
      const acak = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; };
      const cmp = txServerCompare;
      const lama = (rows) => [...rows].sort(cmp);
      const baru = (rows) => window.__myfinanceServices.sortTxRows(rows, cmp);

      const hasilSort = {};
      for (const n of [2500, 20000]) {
        const urut = bikin(n);
        const hasilLama = lama(urut).map((r) => r.id).join(",");
        const hasilBaru = baru(urut).map((r) => r.id).join(",");
        const kocok = acak(urut);
        const kocokLama = lama(kocok).map((r) => r.id).join(",");
        const kocokBaru = baru(kocok).map((r) => r.id).join(",");
        hasilSort[n] = {
          identikSudahTerurut: hasilLama === hasilBaru,
          identikDikocok: kocokLama === kocokBaru,
          lamaSudahTerurutMs: ukur(() => lama(urut)),
          baruSudahTerurutMs: ukur(() => baru(urut)),
          lamaDikocokMs: ukur(() => lama(kocok)),
          baruDikocokMs: ukur(() => baru(kocok)),
        };
      }

      // (b) animateRupiah: replika versi innerText (sebelum v127) vs fungsi app
      // sekarang (textContent), diukur pada 4 elemen dashboard yang sama.
      const ELS = ["dash-total", "dash-in", "dash-out", "dash-total-aset"].map((id) => document.getElementById(id)).filter(Boolean);
      const fmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      const replikaInnerText = (el, target) => {
        if (!el) return;
        const prev = (el.innerText || "").replace(/[^0-9-]/g, "");
        const start = prev ? parseInt(prev, 10) : 0;
        if (!isFinite(start) || start === target) { el.innerText = "Rp " + fmt(target); return; }
        el.innerText = "Rp " + fmt(target);
      };
      const jalankan = (fn) => { ELS.forEach((el, i) => fn(el, 1000000 + i * 12345 + Math.floor(Math.random() * 1000))); };
      const animInnerTextMs = ukur(() => jalankan(replikaInnerText), 15);
      const animTextContentMs = ukur(() => jalankan((el, v) => animateRupiah(el, v, true)), 15);
      return { sort: hasilSort, animInnerTextMs, animTextContentMs, elemenAnimasi: ELS.length };
    });
    console.log("\n=== MICRO A/B (median 7-15 pengulangan) ===");
    for (const [n, v] of Object.entries(micro.sort)) {
      console.log(`  SORT ${n} baris  sudah terurut : lama ${String(v.lamaSudahTerurutMs).padStart(6)} ms -> baru ${String(v.baruSudahTerurutMs).padStart(6)} ms  | hasil identik: ${v.identikSudahTerurut}`);
      console.log(`  SORT ${n} baris  input dikocok : lama ${String(v.lamaDikocokMs).padStart(6)} ms -> baru ${String(v.baruDikocokMs).padStart(6)} ms  | hasil identik: ${v.identikDikocok}`);
    }
    console.log(`  animateRupiah 4 elemen       : innerText ${micro.animInnerTextMs} ms -> textContent ${micro.animTextContentMs} ms`);
  }

  const hasil = {
    rows: bootRows, latencyMs: LATENCY, cpuThrottle: CPU,
    bootShellMs: tShell, bootPaintMs: tPaint, bootDataMs: tData,
    syncPenuhMs: median(syncSamples), crudSyncMs: median(crudSamples),
    render: { filterTransactionsMs: round(renderTx), processDataForUIMs: round(renderDash), renderRecentListMs: round(renderRecent), sortTxServerCompareMs: round(sortCost) },
    jaringanBoot: bootNet.perTabel,
    // v130: dua fase dipisah; keduanya TOTAL atas REPEAT ulangan (bukan per-ulangan).
    jaringanSyncPenuh: diffNet(bootNet.perTabel, netSesudahSync.perTabel),
    jaringanCrud: diffNet(netSesudahSync.perTabel, syncNet.perTabel),
    byteTxBoot: bootNet.perTabel.transactions?.bytes || 0,
    urutanRequestBoot: bootNet.urutanBoot,
    profil,
    micro,
  };

  console.log("\n=== HASIL ===");
  // v131: dua angka boot DICETAK BERSAMA karena artinya beda. "shell terlihat"
  // = frame pertama setelah #appShell ditampilkan (yang dilihat pengguna);
  // "terdeteksi harness" = saat waitForSelector sempat polling (bisa tertinggal
  // jauh bila main thread sibuk). Sebelum v131 hanya angka kedua yang dilaporkan
  // dan dilabeli "appShell tampil", sehingga sempat terbaca sebagai "bobot shell
  // ~1,5 s" padahal shell terpaint ~0,5 s (terukur 461/558 ms vs 1.529/1.564 ms).
  console.log(`BOOT  shell terlihat (paint): ${hasil.bootPaintMs === null ? "n/a" : `${Math.round(hasil.bootPaintMs)} ms`}`);
  console.log(`BOOT  terdeteksi harness   : ${hasil.bootShellMs} ms  (bukan momen terlihat -- lihat catatan v131)`);
  console.log(`BOOT  data cloud ter-commit: ${hasil.bootDataMs} ms  (${bootRows} transaksi)`);
  console.log(`SYNC  loadData() penuh     : ${hasil.syncPenuhMs} ms`);
  console.log(`CRUD  refreshTransactions  : ${hasil.crudSyncMs} ms`);
  console.log(`RENDER filterTransactions  : ${hasil.render.filterTransactionsMs} ms`);
  console.log(`RENDER processDataForUI    : ${hasil.render.processDataForUIMs} ms`);
  console.log(`RENDER renderRecentList    : ${hasil.render.renderRecentListMs} ms`);
  console.log(`SORT   txServerCompare     : ${hasil.render.sortTxServerCompareMs} ms`);
  console.log(`\nJARINGAN saat boot (request / byte):`);
  for (const [t, v] of Object.entries(hasil.jaringanBoot)) console.log(`  ${t.padEnd(24)} ${String(v.request).padStart(2)}x  ${(v.bytes / 1024).toFixed(1)} KB`);
  console.log(`  TOTAL payload transaksi  : ${(hasil.byteTxBoot / 1024).toFixed(1)} KB`);
  console.log(`\nJARINGAN fase SYNC (loadData x${REPEAT}, total semua ulangan):`);
  for (const [t, v] of Object.entries(hasil.jaringanSyncPenuh)) console.log(`  ${t.padEnd(24)} ${String(v.request).padStart(2)}x  ${(v.bytes / 1024).toFixed(1)} KB`);
  console.log(`\nJARINGAN fase CRUD (refreshTransactionsOnly x${REPEAT}, total semua ulangan):`);
  for (const [t, v] of Object.entries(hasil.jaringanCrud)) console.log(`  ${t.padEnd(24)} ${String(v.request).padStart(2)}x  ${(v.bytes / 1024).toFixed(1)} KB`);
  // Snapshot SEBELUM await penutup: `errors` diisi listener async, dan
  // require-atomic-updates menolak keputusan exit-code yang dibaca dari state
  // yang bisa berubah selama await.
  const pageErrors = errors.slice(0, 3);
  if (pageErrors.length) console.log(`\nERROR HALAMAN: ${pageErrors.join(" | ")}`);
  else console.log("\n0 pageerror selama pengukuran.");

  if (process.env.BENCH_JSON) {
    writeFileSync(process.env.BENCH_JSON, JSON.stringify(hasil, null, 2));
    console.log(`\nHasil mentah -> ${process.env.BENCH_JSON}`);
  }
  await browser.close();
  if (internal) internal.server.close();
  // Kode keluar dikembalikan (bukan ditulis ke process.exitCode di dalam fungsi
  // async -- require-atomic-updates menolak state yang dibaca setelah await).
  // Angka yang tidak masuk akal (0 baris termuat) juga dianggap gagal: harness
  // yang "sukses" tanpa data hanya menghasilkan perbandingan yang menipu.
  return pageErrors.length || hasil.rows === 0 ? 1 : 0;
}

function round(n) { return Math.round(n * 10) / 10; }
/** Selisih hitungan jaringan antara dua snapshot (per tabel). */
function diffNet(sebelum, sesudah) {
  const hasil = {};
  for (const [t, v] of Object.entries(sesudah)) {
    const awal = sebelum[t] || { request: 0, bytes: 0 };
    hasil[t] = { request: v.request - awal.request, bytes: v.bytes - awal.bytes };
  }
  return hasil;
}

main()
  .then((kode) => { if (kode !== 0) process.exitCode = kode; })
  .catch((err) => { console.error("Benchmark gagal:", err); process.exitCode = 1; });
