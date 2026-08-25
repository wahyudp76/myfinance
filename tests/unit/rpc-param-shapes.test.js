// Regresi khusus: src/services/supabase/transfers.js, recurring.js, dan budgets.js sempat
// memanggil RPC dengan nama/jumlah parameter yang TIDAK cocok dengan function yang sungguhan
// live di database (ditemukan lewat pemeriksaan manual pg_get_function_arguments() /
// pg_get_functiondef(), bukan dari test otomatis apa pun -- karena memang belum ada test untuk
// 3 modul ini sebelumnya). Test ini pakai mock client (tanpa koneksi Supabase sungguhan) yang
// merekam persis apa yang dikirim ke .rpc(), dibandingkan terhadap signature yang sudah
// diverifikasi manual pada 2026-08-23. Kalau signature RPC-nya berubah lagi di database,
// perbarui assertion di bawah SEKALIGUS baris pg_get_function_arguments() di komentar ini.
import assert from "node:assert/strict";
import test from "node:test";
import { createTransfer } from "../../src/services/supabase/transfers.js";
import { createRecurringTransaction } from "../../src/services/supabase/recurring.js";
import { replaceMonthBudgets } from "../../src/services/supabase/budgets.js";

function mockClient(rpcResult = { data: { id: "mock-id" }, error: null }) {
  const calls = [];
  return {
    calls,
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve(rpcResult);
    },
  };
}

test("createTransfer() calls create_transfer_transaction with the live parameter names (p_akun_sumber, no p_kategori)", async () => {
  const client = mockClient();
  await createTransfer(client, {
    tanggal: "2026-08-23",
    sourceAmount: 100,
    sourceAccount: "USD Card",
    destinationAccount: "BCA IDR",
    sourceCurrency: "USD",
    destinationCurrency: "IDR",
    sourceRateIdrPerUnit: 16000,
    destinationRateIdrPerUnit: 1,
    description: "Top up",
  });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "create_transfer_transaction");
  const params = client.calls[0].params;
  // Signature live (2026-08-23): p_tanggal date, p_jumlah numeric, p_akun_sumber text,
  // p_akun_tujuan text, p_mata_uang_sumber text, p_mata_uang_tujuan text,
  // p_kurs_sumber numeric default 1, p_kurs_tujuan numeric default 1, p_keterangan text default null.
  assert.deepEqual(Object.keys(params).sort(), [
    "p_akun_sumber", "p_akun_tujuan", "p_jumlah", "p_keterangan",
    "p_kurs_sumber", "p_kurs_tujuan", "p_mata_uang_sumber", "p_mata_uang_tujuan", "p_tanggal",
  ].sort());
  assert.equal(params.p_akun_sumber, "USD Card");
  assert.ok(!("p_kategori" in params), "p_kategori tidak ada di RPC yang sungguhan -- jangan dikirim");
});

test("createRecurringTransaction() calls create_recurring_transaction with all 10 live parameters", async () => {
  const client = mockClient();
  await createRecurringTransaction(client, {
    recurringId: "rec-1",
    dueDate: "2026-08-23",
    jenis: "Pengeluaran",
    jumlah: 50000,
    akun: "Cash",
    kategori: "Langganan",
    keterangan: "Netflix",
    mataUang: "IDR",
    kurs: 1,
    jumlahIdr: 50000,
  });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "create_recurring_transaction");
  const params = client.calls[0].params;
  // Signature live (2026-08-23): p_recurring_id uuid, p_due_date date, p_jenis text,
  // p_jumlah numeric, p_akun text, p_kategori text, p_keterangan/p_mata_uang/p_kurs/
  // p_jumlah_idr semuanya default null tapi 6 yang pertama WAJIB diisi.
  assert.deepEqual(Object.keys(params).sort(), [
    "p_akun", "p_due_date", "p_jenis", "p_jumlah", "p_jumlah_idr",
    "p_kategori", "p_keterangan", "p_kurs", "p_mata_uang", "p_recurring_id",
  ].sort());
  for (const required of ["p_recurring_id", "p_due_date", "p_jenis", "p_jumlah", "p_akun", "p_kategori"]) {
    assert.notEqual(params[required], undefined, `${required} wajib diisi, tidak ada default di RPC`);
  }
});

test("replaceMonthBudgets() sends p_budgets as a JSON *object* map, unchanged shape", async () => {
  const client = mockClient();
  await replaceMonthBudgets(client, "2026-08", {
    Makan: 1500000,
    Transport: 500000,
  });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "replace_month_budgets");
  const params = client.calls[0].params;
  assert.deepEqual(Object.keys(params).sort(), ["p_budgets", "p_bulan"].sort());
  // RPC-nya (replace_month_budgets di database) eksplisit: `if jsonb_typeof(p_budgets) <> 'object'
  // then raise exception 'budgets must be a JSON object'` -- array akan SELALU gagal.
  assert.equal(Array.isArray(params.p_budgets), false, "p_budgets harus object map, RPC menolak array");
  assert.deepEqual(params.p_budgets, { Makan: 1500000, Transport: 500000 });
});

test("createTransfer() defaults sourceCurrency/destinationCurrency to null (bukan string wajib diisi) -- transfer IDR-ke-IDR biasa (mayoritas transfer di app ini) tidak mengisi field ini sama sekali", async () => {
  const client = mockClient();
  await createTransfer(client, {
    tanggal: "2026-08-23",
    sourceAmount: 100000,
    sourceAccount: "Cash",
    destinationAccount: "Bank BCA",
    // sourceCurrency/destinationCurrency/rate SENGAJA tidak diisi -- persis kondisi
    // currentTxMataUang = null (default) di index.html.
  });

  assert.equal(client.calls.length, 1);
  const params = client.calls[0].params;
  assert.equal(params.p_mata_uang_sumber, null);
  assert.equal(params.p_mata_uang_tujuan, null);
  assert.equal(params.p_kurs_sumber, 1);
  assert.equal(params.p_kurs_tujuan, 1);
});
