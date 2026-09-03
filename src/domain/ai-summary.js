/**
 * MyFinance -- pembangun RINGKASAN KEUANGAN untuk AI (Gemini via Edge Function
 * `analyze-finance`). Murni, tanpa DOM/Supabase/network.
 *
 * Kenapa modul ini ada (v65):
 * Rekomendasi AI hanya seakurat data yang dikirim. Dulu ringkasan cuma berisi
 * total kasar + 5 kategori + status anggaran tanpa persen, tanpa transaksi
 * terbesar, tanpa pembanding bulan lalu per kategori, tanpa pola (transaksi
 * kecil / akhir pekan), dan tanpa angka turunan -- akibatnya model sering
 * menjawab generik / membulatkan sendiri / salah menyebut nominal. Modul ini
 * menghitung DERIVED METRICS yang presisi di sisi klien (rata-rata harian,
 * proyeksi akhir bulan, tingkat menabung, persen terpakai anggaran, kenaikan
 * per kategori vs bulan lalu, riwayat 6 bulan) dan mengirimnya sebagai angka
 * pasti, sehingga model cukup MERUJUK angka itu, bukan menebak.
 *
 * Kontrak kompatibilitas: nama field lama (dipakai prompt Edge Function yang
 * sedang live) PERTAHAN apa adanya & tetap bernilai sama; field baru hanya
 * DITAMBAHKAN (flat), jadi versi function lama yang belum di-deploy ulang
 * tetap bisa membaca semua angka inti tanpa error.
 */

const BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Kunci YYYY-MM untuk perbandingan deterministik. */
function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Bangun ringkasan keuangan bulan berjalan untuk dikirim ke Gemini.
 *
 * @param {object} ctx - context dari buildInsightsContext()/aggregateDashboardData():
 *   { now, monthIn, monthOut, prevMonthIn, prevMonthOut, monthTxCount,
 *     monthCatOutMap, catOut3MoMap, monthlyMap, prevMonthCatOutMap,
 *     biggestExpense, smallTx, weekendTx } -- kolom pola (v64) opsional; bila
 *   absen, bagian terkait dihitung ulang dari `allTransactions`.
 * @param {object} deps
 * @param {Record<string, number>} deps.budgets - budget kategori bulan berjalan.
 * @param {Array<object>} deps.allTransactions - SEMUA baris transaksi (untuk
 *   saldo gabungan & top-3 transaksi terbesar bulan ini).
 * @param {(t: object) => number} deps.txIdrAmount - nilai IDR-equivalent 1 transaksi.
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @returns {Record<string, unknown>} ringkasan flat (angka bulat rupiah, tanpa
 *   nilai float/NaN), siap JSON.stringify.
 */
export function buildAiFinanceSummary(ctx, {
  budgets = {},
  allTransactions = [],
  txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah),
  parseTgl = (s) => new Date(s),
} = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);

  const monthIn = Math.round(Number(ctx.monthIn) || 0);
  const monthOut = Math.round(Number(ctx.monthOut) || 0);
  const prevMonthIn = Math.round(Number(ctx.prevMonthIn) || 0);
  const prevMonthOut = Math.round(Number(ctx.prevMonthOut) || 0);
  const net = monthIn - monthOut;
  const avgDaily = dayOfMonth > 0 ? Math.round(monthOut / dayOfMonth) : 0;
  const projected = remainingDays > 0 ? avgDaily * daysInMonth : monthOut;

  // --- status anggaran: persen terpakai & sisa dihitung di sini (presisi) ---
  const budgetEntries = Object.keys(budgets || {})
    .map((cat) => ({ cat, anggaran: Math.round(Number(budgets[cat]) || 0) }))
    .filter((b) => b.anggaran > 0)
    .map((b) => {
      const terpakai = Math.round(Number((ctx.monthCatOutMap || {})[b.cat]) || 0);
      return {
        kategori: b.cat,
        anggaran: b.anggaran,
        terpakai,
        persen_terpakai: Math.min(999, Math.round((terpakai / b.anggaran) * 100)),
        sisa: Math.max(0, b.anggaran - terpakai),
      };
    })
    .sort((a, b) => b.persen_terpakai - a.persen_terpakai)
    .slice(0, 8);

  // --- top kategori pengeluaran bulan ini (dengan persen dari total) ---
  const catTot = Object.values(ctx.monthCatOutMap || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const topCats = Object.entries(ctx.monthCatOutMap || {})
    .map(([kategori, jumlah]) => ({
      kategori,
      jumlah: Math.round(Number(jumlah) || 0),
      persen_dari_total: catTot > 0 ? Math.round((Number(jumlah) / catTot) * 100) : 0,
    }))
    .sort((a, b) => b.jumlah - a.jumlah)
    .slice(0, 8);

  // --- kategori bulan lalu (pembanding kenaikan) ---
  const prevCats = Object.entries(ctx.prevMonthCatOutMap || {})
    .map(([kategori, jumlah]) => ({ kategori, jumlah: Math.round(Number(jumlah) || 0) }))
    .sort((a, b) => b.jumlah - a.jumlah)
    .slice(0, 8);

  // --- kategori naik tajam vs bulan lalu (hitung presisi, bukan tebakan model) ---
  const risers = [];
  Object.entries(ctx.monthCatOutMap || {}).forEach(([cat, curRaw]) => {
    const prev = Number((ctx.prevMonthCatOutMap || {})[cat]) || 0;
    const cur = Number(curRaw) || 0;
    if (prev >= 50000 && cur >= prev * 1.3 && cur >= prev + 50000) {
      risers.push({ kategori: cat, bulan_lalu: Math.round(prev), bulan_ini: Math.round(cur), kenaikan_persen: Math.round((cur / prev - 1) * 100) });
    }
  });
  risers.sort((a, b) => b.kenaikan_persen - a.kenaikan_persen);

  // --- top-3 transaksi pengeluaran terbesar bulan ini (dari baris transaksi) ---
  const curKey = monthKeyOf(now);
  const biggestTx = [];
  (allTransactions || []).forEach((t) => {
    if (!t || t.jenis !== "Pengeluaran") return;
    const date = parseTgl(t.tanggal);
    if (!date || Number.isNaN(date.getTime()) || monthKeyOf(date) !== curKey) return;
    const jumlah = Math.round(Number(txIdrAmount(t)) || 0);
    if (jumlah <= 0) return;
    biggestTx.push({
      kategori: String(t.kategori || "Lain-lain"),
      akun: String(t.akun || ""),
      tanggal: String(t.tanggal || "").slice(0, 10),
      keterangan: String(t.keterangan || "").slice(0, 80),
      jumlah,
    });
  });
  biggestTx.sort((a, b) => b.jumlah - a.jumlah);
  const top3Tx = biggestTx.slice(0, 3);

  // --- riwayat 6 bulan terakhir (tren) -- label "Agu 2026" diurutkan secara
  // KRONOLOGIS (tahun*12 + indeks bulan), bukan alfabetis (slice(-6) alfabetis
  // bisa salah ambil bulan). ---
  const chronoKey = (label) => {
    const parts = String(label).split(" ");
    const mIdx = BULAN_ID.indexOf(parts[0]);
    return (Number(parts[1]) || 0) * 12 + (mIdx >= 0 ? mIdx : 0);
  };
  const monthlyKeys = Object.keys(ctx.monthlyMap || {}).sort((a, b) => chronoKey(a) - chronoKey(b)).slice(-6);
  const sixMonths = monthlyKeys.map((label) => {
    const m = ctx.monthlyMap[label];
    return {
      bulan: label,
      pemasukan: Math.round(Number(m.in) || 0),
      pengeluaran: Math.round(Number(m.out) || 0),
    };
  });

  // --- saldo gabungan: perilaku LAMA dipertahankan (Pemasukan +, Pengeluaran -,
  // Transfer tidak dihitung -- ini estimasi, bukan saldo buku) ---
  let saldoGabungan = 0;
  (allTransactions || []).forEach((t) => {
    if (!t) return;
    if (t.jenis === "Pemasukan") saldoGabungan += Number(txIdrAmount(t)) || 0;
    else if (t.jenis === "Pengeluaran") saldoGabungan -= Number(txIdrAmount(t)) || 0;
  });
  saldoGabungan = Math.round(saldoGabungan);

  const smallTx = ctx.smallTx || null;
  const weekendTx = ctx.weekendTx || null;

  const summary = {
    // identitas waktu
    tanggal_hari_ini_ke: dayOfMonth,
    total_hari_dalam_bulan: daysInMonth,
    sisa_hari_dalam_bulan: remainingDays,
    // arus bulan ini + angka turunan presisi
    pemasukan_bulan_ini: monthIn,
    pengeluaran_bulan_ini: monthOut,
    selisih_bulan_ini: net,
    tingkat_menabung_persen: monthIn > 0 ? Math.round(((monthIn - monthOut) / monthIn) * 1000) / 10 : null,
    rata_rata_pengeluaran_harian: avgDaily,
    proyeksi_pengeluaran_akhir_bulan: projected,
    // pembanding bulan lalu
    pemasukan_bulan_lalu: prevMonthIn,
    pengeluaran_bulan_lalu: prevMonthOut,
    // aktivitas
    jumlah_transaksi_bulan_ini: Math.round(Number(ctx.monthTxCount) || 0),
    // rincian kategori & anggaran
    top_kategori_pengeluaran_bulan_ini: topCats,
    status_anggaran_bulan_ini: budgetEntries,
    kategori_bulan_lalu: prevCats,
    kategori_naik_vs_bulan_lalu: risers.slice(0, 4),
    riwayat_enam_bulan: sixMonths,
    // pola transaksi (opsional bila context v64 tersedia)
    transaksi_terbesar_bulan_ini: top3Tx,
    transaksi_kecil_bulan_ini: smallTx ? {
      jumlah_transaksi: Math.round(Number(smallTx.count) || 0),
      total: Math.round(Number(smallTx.total) || 0),
    } : { jumlah_transaksi: 0, total: 0 },
    pengeluaran_akhir_pekan_bulan_ini: weekendTx ? {
      jumlah_transaksi: Math.round(Number(weekendTx.count) || 0),
      total: Math.round(Number(weekendTx.out) || 0),
      persen_dari_total: monthOut > 0 ? Math.round(((Number(weekendTx.out) || 0) / monthOut) * 100) : 0,
    } : { jumlah_transaksi: 0, total: 0, persen_dari_total: 0 },
    // akun & saldo
    estimasi_saldo_gabungan_semua_akun: saldoGabungan,
  };

  return summary;
}
