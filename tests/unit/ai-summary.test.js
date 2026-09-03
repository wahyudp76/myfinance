// Unit test src/domain/ai-summary.js (v65): ringkasan keuangan yang dikirim ke
// Gemini (Edge Function analyze-finance). Fokus: (1) nama field LAMA tetap ada
// & nilainya sama (kompatibilitas function yang masih live), (2) angka turunan
// presisi dihitung klien (rata2 harian, proyeksi akhir bulan, tingkat menabung,
// persen anggaran, kenaikan per kategori, riwayat 6 bulan KRONOLOGIS), (3) pola
// transaksi (top-3 terbesar, transaksi kecil, akhir pekan) ikut terkirim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAiFinanceSummary } from "../../src/domain/ai-summary.js";

const NOW = new Date(2026, 7, 20); // 20 Agustus 2026 (31 hari)
const parseTgl = (s) => new Date(`${s}T12:00:00`);
const txIdrAmount = (t) => Number(t.jumlah);

function baseCtx(overrides = {}) {
  return {
    now: NOW,
    monthIn: 2_000_000,
    monthOut: 1_250_000,
    prevMonthIn: 1_800_000,
    prevMonthOut: 1_000_000,
    monthTxCount: 24,
    monthCatOutMap: { "Makanan & Minuman": 500_000, "Tagihan & Biaya": 450_000, Transportasi: 300_000 },
    catOut3MoMap: {},
    monthlyMap: {
      "Des 2025": { in: 100, out: 100 },
      "Mar 2026": { in: 1_000_000, out: 900_000 },
      "Apr 2026": { in: 1_000_000, out: 800_000 },
      "Mei 2026": { in: 1_000_000, out: 700_000 },
      "Jun 2026": { in: 1_000_000, out: 600_000 },
      "Jul 2026": { in: 1_000_000, out: 500_000 },
      "Agu 2026": { in: 2_000_000, out: 1_250_000 },
    },
    prevMonthCatOutMap: { "Makanan & Minuman": 400_000, "Tagihan & Biaya": 150_000 },
    biggestExpense: null,
    smallTx: { count: 7, total: 140_000 },
    weekendTx: { count: 6, out: 500_000 },
    ...overrides,
  };
}

function baseTx() {
  const t = (id, jenis, kategori, tanggal, jumlah, keterangan) => ({ id, jenis, kategori, tanggal, jumlah: String(jumlah), keterangan });
  return [
    t("gaji", "Pemasukan", "Gaji", "2026-08-05", 5_000_000, "Gaji bulanan"),
    t("m1", "Pengeluaran", "Makanan", "2026-08-03", 200_000, "Makan siang"),
    t("m2", "Pengeluaran", "Makanan", "2026-08-10", 300_000, "Makan malam keluarga"),
    t("tr", "Pengeluaran", "Transportasi", "2026-08-12", 300_000, "Ojek"),
    t("li", "Pengeluaran", "Listrik", "2026-08-05", 450_000, "Token listrik"),
    // di luar bulan berjalan -- tidak masuk top-3, tapi memengaruhi saldo gabungan
    t("gajiLalu", "Pemasukan", "Gaji", "2026-03-01", 100_000, "lama"),
    t("outLalu", "Pengeluaran", "Makanan", "2026-03-02", 50_000, "lama"),
  ];
}

test("buildAiFinanceSummary: field lama dipertahankan nama & nilainya (kompatibilitas function live)", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.equal(s.tanggal_hari_ini_ke, 20);
  assert.equal(s.total_hari_dalam_bulan, 31);
  assert.equal(s.pemasukan_bulan_ini, 2_000_000);
  assert.equal(s.pengeluaran_bulan_ini, 1_250_000);
  assert.equal(s.pemasukan_bulan_lalu, 1_800_000);
  assert.equal(s.pengeluaran_bulan_lalu, 1_000_000);
  assert.equal(s.jumlah_transaksi_bulan_ini, 24);
  assert.equal(typeof s.estimasi_saldo_gabungan_semua_akun, "number");
});

test("buildAiFinanceSummary: derived metrics presisi (selisih, tabungan %, rata2 harian, proyeksi)", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.equal(s.selisih_bulan_ini, 750_000);
  assert.equal(s.tingkat_menabung_persen, 37.5); // (2jt-1,25jt)/2jt
  assert.equal(s.rata_rata_pengeluaran_harian, 62_500); // 1,25jt/20 hari
  assert.equal(s.sisa_hari_dalam_bulan, 11);
  assert.equal(s.proyeksi_pengeluaran_akhir_bulan, 1_937_500); // 62.500 x 31
});

test("buildAiFinanceSummary: top kategori dengan persen dari total, urut menurun, cap 8", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.deepEqual(s.top_kategori_pengeluaran_bulan_ini, [
    { kategori: "Makanan & Minuman", jumlah: 500_000, persen_dari_total: 40 },
    { kategori: "Tagihan & Biaya", jumlah: 450_000, persen_dari_total: 36 },
    { kategori: "Transportasi", jumlah: 300_000, persen_dari_total: 24 },
  ]);
});

test("buildAiFinanceSummary: status anggaran memuat persen_terpakai & sisa, urut terbesar", () => {
  const s = buildAiFinanceSummary(baseCtx(), {
    budgets: { Transportasi: 250_000, "Tagihan & Biaya": 400_000, "Makanan & Minuman": 600_000 },
    allTransactions: baseTx(), txIdrAmount, parseTgl,
  });
  const map = Object.fromEntries(s.status_anggaran_bulan_ini.map((b) => [b.kategori, b]));
  assert.equal(map.Transportasi.persen_terpakai, 120); // 300/250 -- over budget
  assert.equal(map.Transportasi.sisa, 0);
  assert.equal(map["Makanan & Minuman"].persen_terpakai, 83); // 500/600
  assert.equal(map["Makanan & Minuman"].sisa, 100_000);
  assert.equal(map["Tagihan & Biaya"].persen_terpakai, 113); // 450/400
  // urut persen_terpakai desc: Transportasi(120), Tagihan(113), Makanan(83)
  assert.deepEqual(s.status_anggaran_bulan_ini.map((b) => b.kategori), ["Transportasi", "Tagihan & Biaya", "Makanan & Minuman"]);
});

test("buildAiFinanceSummary: top-3 transaksi terbesar bulan ini dari baris transaksi", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.equal(s.transaksi_terbesar_bulan_ini.length, 3);
  assert.equal(s.transaksi_terbesar_bulan_ini[0].kategori, "Listrik");
  assert.equal(s.transaksi_terbesar_bulan_ini[0].jumlah, 450_000);
  assert.equal(s.transaksi_terbesar_bulan_ini[0].keterangan, "Token listrik");
  assert.equal(s.transaksi_terbesar_bulan_ini[0].tanggal, "2026-08-05");
  const totals = s.transaksi_terbesar_bulan_ini.map((t) => t.jumlah);
  assert.deepEqual(totals, [450_000, 300_000, 300_000]); // urut menurun
});

test("buildAiFinanceSummary: kategori naik vs bulan lalu dihitung presisi (>=50rb & >=30%)", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  // Tagihan 150rb -> 450rb (+200%); Makanan 400rb -> 500rb (+25%, di bawah 30% -> tidak masuk)
  assert.deepEqual(s.kategori_naik_vs_bulan_lalu, [
    { kategori: "Tagihan & Biaya", bulan_lalu: 150_000, bulan_ini: 450_000, kenaikan_persen: 200 },
  ]);
  assert.deepEqual(s.kategori_bulan_lalu.map((k) => k.kategori), ["Makanan & Minuman", "Tagihan & Biaya"]);
});

test("buildAiFinanceSummary: pola transaksi kecil & akhir pekan ikut terkirim dgn persen", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.deepEqual(s.transaksi_kecil_bulan_ini, { jumlah_transaksi: 7, total: 140_000 });
  assert.deepEqual(s.pengeluaran_akhir_pekan_bulan_ini, { jumlah_transaksi: 6, total: 500_000, persen_dari_total: 40 });
});

test("buildAiFinanceSummary: riwayat 6 bulan KRONOLOGIS (bukan alfabetis -- 'Des 2025' terbuang)", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  assert.equal(s.riwayat_enam_bulan.length, 6);
  assert.deepEqual(s.riwayat_enam_bulan.map((m) => m.bulan), ["Mar 2026", "Apr 2026", "Mei 2026", "Jun 2026", "Jul 2026", "Agu 2026"]);
  assert.equal(s.riwayat_enam_bulan.at(-1).pemasukan, 2_000_000);
});

test("buildAiFinanceSummary: saldo gabungan menghitung SEMUA transaksi (Pemasukan +, Pengeluaran -)", () => {
  const s = buildAiFinanceSummary(baseCtx(), { budgets: {}, allTransactions: baseTx(), txIdrAmount, parseTgl });
  // 5jt + 100rb (masuk) - (200+300+300+450)rb - 50rb = 3,8jt
  assert.equal(s.estimasi_saldo_gabungan_semua_akun, 3_800_000);
});

test("buildAiFinanceSummary: context miskin (tanpa pola v64) tetap aman & field nol/[]", () => {
  const ctx = { now: NOW, monthIn: 0, monthOut: 0, prevMonthIn: 0, prevMonthOut: 0, monthTxCount: 0, monthCatOutMap: {}, catOut3MoMap: {}, monthlyMap: {} };
  const s = buildAiFinanceSummary(ctx, { budgets: {}, allTransactions: [], txIdrAmount, parseTgl });
  assert.equal(s.transaksi_terbesar_bulan_ini.length, 0);
  assert.deepEqual(s.transaksi_kecil_bulan_ini, { jumlah_transaksi: 0, total: 0 });
  assert.deepEqual(s.pengeluaran_akhir_pekan_bulan_ini, { jumlah_transaksi: 0, total: 0, persen_dari_total: 0 });
  assert.deepEqual(s.kategori_bulan_lalu, []);
  assert.deepEqual(s.kategori_naik_vs_bulan_lalu, []);
  assert.deepEqual(s.riwayat_enam_bulan, []);
  assert.equal(s.tingkat_menabung_persen, null);
  // tidak ada NaN/float aneh
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), k);
  }
});
