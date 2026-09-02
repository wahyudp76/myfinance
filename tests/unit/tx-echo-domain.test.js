// Unit test helper echo lokal pasca-simpan (src/domain/transactions.js):
// insertTransactionRow & replaceTransactionRow -- urutan globalData harus sama
// persis dengan hasil list() (tanggal DESC, created_at DESC = jam input
// pencatatan, id ASC cuma tie-break) supaya echo lokal tidak pernah beda
// tampilannya dengan fetch ulang. id = UUID acak (gen_random_uuid), jadi urutan
// transaksi se-hari TIDAK boleh lagi memakai id -- harus created_at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertTransactionRow, replaceTransactionRow } from "../../src/domain/transactions.js";

// Baris nyata dari list() selalu punya created_at (server, default now()).
// BASE di bawah sudah dalam urutan server: tanggal DESC, created_at DESC.
const OLD = { id: "t-1", tanggal: "2026-08-01", jumlah: 100, created_at: "2026-08-01T02:00:00.000Z" };
const TODAY_A = { id: "t-2", tanggal: "2026-08-30", jumlah: 200, created_at: "2026-08-30T09:00:00.000Z" };
const TODAY_B = { id: "t-3", tanggal: "2026-08-30", jumlah: 300, created_at: "2026-08-30T10:00:00.000Z" };
const BASE = [TODAY_B, TODAY_A, OLD]; // urutan server: tanggal desc, created_at desc

test("insertTransactionRow: baris baru di tanggal terbaru diletakkan SEBELUM tanggal lebih lama", () => {
  const row = { id: "t-4", tanggal: "2026-08-31", jumlah: 400, created_at: "2026-08-31T08:00:00.000Z" };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-4", "t-3", "t-2", "t-1"]);
});

test("insertTransactionRow: baris di tanggal yang SAMA diletakkan SETELAH baris se-tanggal yang DICATAT SETELAHNYA (created_at desc)", () => {
  // Dicatat 11:00 -> paling baru di antara baris 30/08 -> tampil PALING ATAS
  // dari grup tanggal itu (sebelumnya tes ini mengharapkan paling bawah karena
  // asumsi lama "id lebih besar = belakangan", salah utk UUID).
  const row = { id: "t-9", tanggal: "2026-08-30", jumlah: 900, created_at: "2026-08-30T11:00:00.000Z" };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-9", "t-3", "t-2", "t-1"]);
});

test("insertTransactionRow: baris se-hari yang DICATAT PALING AWAL diletakkan paling bawah grup tanggalnya", () => {
  const row = { id: "t-8", tanggal: "2026-08-30", jumlah: 800, created_at: "2026-08-30T08:00:00.000Z" };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-8", "t-1"]);
});

test("insertTransactionRow: tanggal lebih lama diletakkan sebelum tanggal termuda di bawahnya", () => {
  const row = { id: "t-5", tanggal: "2026-08-15", jumlah: 150, created_at: "2026-08-15T07:00:00.000Z" };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-5", "t-1"]);
});

test("insertTransactionRow: created_at sama persis -> tie-break id ASC (deterministik)", () => {
  const rows = [
    { id: "t-2", tanggal: "2026-08-30", created_at: "2026-08-30T10:00:00.000Z" },
    { id: "t-3", tanggal: "2026-08-30", created_at: "2026-08-30T10:00:00.000Z" },
  ];
  const out = insertTransactionRow(rows, { id: "t-9", tanggal: "2026-08-30", created_at: "2026-08-30T10:00:00.000Z" });
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-9"]);
});

test("insertTransactionRow: sisipan berurutan mempertahankan urutan server (terbaru -> terlama)", () => {
  const sorted = [
    { id: "b", tanggal: "2026-07-01", created_at: "2026-07-01T10:00:00.000Z" },
    { id: "c", tanggal: "2026-03-15", created_at: "2026-03-15T10:00:00.000Z" },
    { id: "a", tanggal: "2026-01-05", created_at: "2026-01-05T10:00:00.000Z" },
  ];
  const step1 = insertTransactionRow(sorted, { id: "d", tanggal: "2026-06-01", created_at: "2026-06-01T10:00:00.000Z" });
  assert.deepEqual(step1.map((r) => r.id), ["b", "d", "c", "a"]);
  const step2 = insertTransactionRow(step1, { id: "e", tanggal: "2026-01-10", created_at: "2026-01-10T10:00:00.000Z" });
  assert.deepEqual(step2.map((r) => r.id), ["b", "d", "c", "e", "a"]);
  const step3 = insertTransactionRow(step2, { id: "f", tanggal: "2025-12-31", created_at: "2025-12-31T10:00:00.000Z" });
  assert.deepEqual(step3.map((r) => r.id), ["b", "d", "c", "e", "a", "f"]);
});

test("insertTransactionRow: row se-tanggal TANPA created_at (stub lama) -> paling bawah grup tanggal (perilaku lama stabil, bukan lompat ke atas)", () => {
  const rows = [
    { id: "t-2", tanggal: "2026-08-30", created_at: "2026-08-30T09:00:00.000Z" },
    { id: "t-1", tanggal: "2026-08-01", created_at: "2026-08-01T02:00:00.000Z" },
  ];
  const out = insertTransactionRow(rows, { id: "t-9", tanggal: "2026-08-30", jumlah: 1 }); // tanpa created_at
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-9", "t-1"]);
});

test("insertTransactionRow: bila SEMUA row se-tanggal tanpa created_at -> urutan id ASC seperti dulu (kompatibilitas fixture tanpa created_at)", () => {
  const legacy = [
    { id: "t-2", tanggal: "2026-08-30", jumlah: 200 },
    { id: "t-3", tanggal: "2026-08-30", jumlah: 300 },
    { id: "t-1", tanggal: "2026-08-01", jumlah: 100 },
  ];
  const out = insertTransactionRow(legacy, { id: "t-9", tanggal: "2026-08-30", jumlah: 900 });
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-9", "t-1"]);
});

test("insertTransactionRow: baris tanpa tanggal ditambahkan di akhir (tidak crash)", () => {
  const out = insertTransactionRow(BASE, { id: "z", tanggal: null });
  assert.equal(out.at(-1).id, "z");
});

test("insertTransactionRow: input bukan array -> array baru dengan barisnya", () => {
  const out = insertTransactionRow(null, { id: "a", tanggal: "2026-01-01" });
  assert.deepEqual(out, [{ id: "a", tanggal: "2026-01-01" }]);
});

test("replaceTransactionRow: ganti by id, posisi dipertahankan", () => {
  const row = { id: "t-2", tanggal: "2026-08-30", jumlah: 999, created_at: "2026-08-30T09:00:00.000Z" };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-1"]);
  assert.equal(out[1].jumlah, 999);
});

test("replaceTransactionRow: tanggal BERUBAH -> dipindah ke posisi urutan server yang benar", () => {
  const row = { id: "t-2", tanggal: "2026-08-10", jumlah: 222, created_at: "2026-08-10T05:00:00.000Z" };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-1"]);
});

test("replaceTransactionRow: tanggal sama tapi created_at diubah -> ikut jam input baru (dipindah ke atas grup bila lebih baru)", () => {
  const row = { id: "t-2", tanggal: "2026-08-30", jumlah: 222, created_at: "2026-08-30T12:00:00.000Z" };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-1"]);
});

test("replaceTransactionRow: id belum ada -> disisipkan seperti baris baru", () => {
  const row = { id: "t-99", tanggal: "2026-08-29", jumlah: 5, created_at: "2026-08-29T10:00:00.000Z" };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-99", "t-1"]);
});

test("replaceTransactionRow: baris null/tanpa id -> array tidak berubah (tidak crash)", () => {
  assert.deepEqual(replaceTransactionRow(BASE, null), BASE);
  assert.deepEqual(replaceTransactionRow(BASE, { tanggal: "2026-01-01" }), BASE);
});
