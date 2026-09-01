// Tier-3 onboarding #8: pembangkit data contoh (murni & deterministik).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDemoTransaction, buildDemoTransactions } from "../../src/domain/demo-data.js";

test("buildDemoTransactions: deterministik (2 panggilan identik)", () => {
  const today = new Date("2026-08-15T03:00:00");
  assert.deepEqual(
    buildDemoTransactions({ today, accounts: ["Bank BCA", "GoPay"] }),
    buildDemoTransactions({ today, accounts: ["Bank BCA", "GoPay"] })
  );
});

test("buildDemoTransactions: semua baris bertanda [Demo], field lengkap, jenis valid", () => {
  const rows = buildDemoTransactions({ today: new Date("2026-08-15T03:00:00") });
  assert.ok(rows.length >= 12 && rows.length <= 20, `jumlah wajar, didapat ${rows.length}`);
  rows.forEach((r) => {
    assert.ok(isDemoTransaction(r), "bertanda [Demo]: " + r.keterangan);
    assert.ok(r.jenis === "Pemasukan" || r.jenis === "Pengeluaran");
    assert.ok(r.jumlah > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.tanggal), "tanggal ISO: " + r.tanggal);
    assert.equal(r.mata_uang, "IDR");
    assert.ok(r.akun.length > 0);
    assert.ok(r.kategori.length > 0);
  });
});

test("buildDemoTransactions: TIDAK ada transaksi masa depan (bulan ini dipotong hari ini)", () => {
  const today = new Date("2026-08-10T03:00:00"); // tgl 10 -> bulan ini hanya day<=10
  const rows = buildDemoTransactions({ today });
  const now = today.getTime();
  rows.forEach((r) => assert.ok(new Date(r.tanggal + "T00:00:00").getTime() <= now, r.tanggal));
  const bulanIni = rows.filter((r) => r.tanggal.startsWith("2026-08"));
  assert.ok(bulanIni.length > 0 && bulanIni.length < 9, "bulan ini terpotong, bukan penuh");
});

test("buildDemoTransactions: bulan lalu selalu penuh + tahun bergulir (Jan -> Des)", () => {
  const rows = buildDemoTransactions({ today: new Date("2026-01-05T03:00:00") });
  assert.ok(rows.some((r) => r.tanggal.startsWith("2025-12-")), "Desember tahun sebelumnya ada");
});

test("buildDemoTransactions: akun user dipakai; fallback bila nama bawaan tak ada", () => {
  const rows = buildDemoTransactions({ today: new Date("2026-08-15T03:00:00"), accounts: ["Dompetku"] });
  assert.ok(rows.length > 0);
  rows.forEach((r) => assert.equal(r.akun, "Dompetku"));
  const def = buildDemoTransactions({ today: new Date("2026-08-15T03:00:00"), accounts: [] });
  def.forEach((r) => assert.ok(["Bank BCA", "GoPay", "Tunai (Cash)"].includes(r.akun)));
});

test("isDemoTransaction: hanya keterangan berprefix marker", () => {
  assert.equal(isDemoTransaction({ keterangan: "[Demo] Gaji" }), true);
  assert.equal(isDemoTransaction({ keterangan: "Gaji" }), false);
  assert.equal(isDemoTransaction({}), false);
  assert.equal(isDemoTransaction(null), false);
});
