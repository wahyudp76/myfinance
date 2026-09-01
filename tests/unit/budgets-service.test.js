// Test service layer budgets (src/services/supabase/budgets.js) -- fokus baru:
// fetchMonthBudgets(), hasil pemindahan body getBudgetsRemote() dari adapter `api`
// di index.html saat pensyahan api.run (slice budgets). Mock client tanpa koneksi
// Supabase sungguhan, merekam rantai from().select().eq() -- pola yang sama dengan
// tests/unit/rpc-param-shapes.test.js.
import assert from "node:assert/strict";
import test from "node:test";
import { fetchMonthBudgets } from "../../src/services/supabase/budgets.js";

function mockQueryClient(result = { data: [], error: null }) {
  const calls = [];
  const client = {
    calls,
    // requireClient() mengecek .rpc -- sediakan, tapi jadikan tripwire: service query
    // (fetchMonthBudgets) TIDAK boleh memanggil rpc sama sekali.
    rpc() { throw new Error("rpc() tidak boleh dipanggil oleh fetchMonthBudgets"); },
    from(table) {
      calls.push({ table });
      const step = {
        _cols: null, _filter: null,
        select(cols) { step._cols = cols; calls[calls.length - 1].cols = cols; return this; },
        eq(col, val) { calls[calls.length - 1].filter = { col, val }; return Promise.resolve(result); },
      };
      return step;
    },
  };
  return client;
}

test("fetchMonthBudgets(): query ke tabel budgets dgn kolom 'kategori, jumlah' & filter bulan", async () => {
  const client = mockQueryClient({ data: [], error: null });
  await fetchMonthBudgets(client, "2026-08");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].table, "budgets");
  assert.equal(client.calls[0].cols, "kategori, jumlah");
  assert.deepEqual(client.calls[0].filter, { col: "bulan", val: "2026-08" });
});

test("fetchMonthBudgets(): baris diubah jadi map {kategori: jumlah} dgn jumlah dinormalisasi ke Number", async () => {
  const client = mockQueryClient({
    data: [
      { kategori: "Makanan", jumlah: "1500000" },  // Postgres numeric datang sebagai string
      { kategori: "Transport", jumlah: 500000 },
    ],
    error: null,
  });
  const map = await fetchMonthBudgets(client, "2026-08");
  assert.deepEqual(map, { Makanan: 1500000, Transport: 500000 });
  assert.equal(typeof map.Makanan, "number");
});

test("fetchMonthBudgets(): tanpa baris -> map kosong (bukan null/undefined)", async () => {
  const client = mockQueryClient({ data: null, error: null });
  assert.deepEqual(await fetchMonthBudgets(client, "2026-01"), {});
});

test("fetchMonthBudgets(): error dari PostgREST di-lempar utk ditangani .catch pemanggil", async () => {
  const client = mockQueryClient({ data: null, error: new Error("RLS denied") });
  await assert.rejects(() => fetchMonthBudgets(client, "2026-08"), /RLS denied/);
});

test("fetchMonthBudgets(): format bulan invalid ditolak SEBELUM query jalan", async () => {
  const client = mockQueryClient();
  await assert.rejects(() => fetchMonthBudgets(client, "2026-8"), /YYYY-MM/);
  await assert.rejects(() => fetchMonthBudgets(client, ""), /YYYY-MM/);
  assert.equal(client.calls.length, 0);
});

test("fetchMonthBudgets(): client null/tidak valid ditolak requireClient", async () => {
  await assert.rejects(() => fetchMonthBudgets(null, "2026-08"), /tidak tersedia/);
  await assert.rejects(() => fetchMonthBudgets({}, "2026-08"), /tidak tersedia/);
});

test("fetchMonthBudgets(): month valid tanggal-posisi bebas (bukan hanya bulan berjalan)", async () => {
  const client = mockQueryClient({ data: [], error: null });
  await fetchMonthBudgets(client, "2024-12");
  assert.equal(client.calls[0].filter.val, "2024-12");
});
