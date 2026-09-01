// Unit test helper echo lokal pasca-simpan (src/domain/transactions.js):
// insertTransactionRow & replaceTransactionRow -- urutan globalData harus sama
// persis dengan hasil list() (tanggal DESC, id ASC) supaya echo lokal tidak
// pernah beda tampilannya dengan fetch ulang.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertTransactionRow, replaceTransactionRow } from "../../src/domain/transactions.js";

const OLD = { id: "t-1", tanggal: "2026-08-01", jumlah: 100 };
const TODAY_A = { id: "t-2", tanggal: "2026-08-30", jumlah: 200 };
const TODAY_B = { id: "t-3", tanggal: "2026-08-30", jumlah: 300 };
const BASE = [TODAY_A, TODAY_B, OLD]; // urutan server: tanggal desc, id asc

test("insertTransactionRow: baris baru di tanggal terbaru diletakkan SEBELUM tanggal lebih lama", () => {
  const row = { id: "t-4", tanggal: "2026-08-31", jumlah: 400 };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-4", "t-2", "t-3", "t-1"]);
});

test("insertTransactionRow: baris di tanggal yang SAMA diletakkan SETELAH baris se-tanggal (id asc)", () => {
  const row = { id: "t-9", tanggal: "2026-08-30", jumlah: 900 };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-9", "t-1"]);
});

test("insertTransactionRow: tanggal lebih lama diletakkan sebelum tanggal termuda di bawahnya", () => {
  const row = { id: "t-5", tanggal: "2026-08-15", jumlah: 150 };
  const out = insertTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-5", "t-1"]);
});

test("insertTransactionRow: sisipan berurutan mempertahankan urutan server (terbaru -> terlama)", () => {
  // Base sudah terurut server (tanggal desc); fungsi hanya menyisipkan baris baru
  // di posisi yang benar, tanpa mengubah urutan baris lama.
  const sorted = [
    { id: "b", tanggal: "2026-07-01" },
    { id: "c", tanggal: "2026-03-15" },
    { id: "a", tanggal: "2026-01-05" },
  ];
  const step1 = insertTransactionRow(sorted, { id: "d", tanggal: "2026-06-01" });
  assert.deepEqual(step1.map((r) => r.id), ["b", "d", "c", "a"]);
  const step2 = insertTransactionRow(step1, { id: "e", tanggal: "2026-01-10" });
  assert.deepEqual(step2.map((r) => r.id), ["b", "d", "c", "e", "a"]);
  const step3 = insertTransactionRow(step2, { id: "f", tanggal: "2025-12-31" });
  assert.deepEqual(step3.map((r) => r.id), ["b", "d", "c", "e", "a", "f"]);
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
  const row = { id: "t-2", tanggal: "2026-08-30", jumlah: 999 };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-1"]);
  assert.equal(out[0].jumlah, 999);
});

test("replaceTransactionRow: tanggal BERUBAH -> dipindah ke posisi urutan server yang benar", () => {
  const row = { id: "t-2", tanggal: "2026-08-10", jumlah: 222 };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-3", "t-2", "t-1"]);
});

test("replaceTransactionRow: id belum ada -> disisipkan seperti baris baru", () => {
  const row = { id: "t-99", tanggal: "2026-08-29", jumlah: 5 };
  const out = replaceTransactionRow(BASE, row);
  assert.deepEqual(out.map((r) => r.id), ["t-2", "t-3", "t-99", "t-1"]);
});

test("replaceTransactionRow: baris null/tanpa id -> array tidak berubah (tidak crash)", () => {
  assert.deepEqual(replaceTransactionRow(BASE, null), BASE);
  assert.deepEqual(replaceTransactionRow(BASE, { tanggal: "2026-01-01" }), BASE);
});
