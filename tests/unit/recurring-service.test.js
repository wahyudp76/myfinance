// Test service layer recurring (src/services/supabase/recurring.js) -- fungsi
// tabel recurring_transactions hasil pemindahan body fetch/add/edit/delete/
// setActive/advanceDueDateRemote dari adapter `api` di index.html saat pensyahan
// api.run (slice recurring), plus 2 normalizer (toRecurringRecord &
// toCreateRecurringParams). Mock pakai helpers/mock-supabase-client.js (query
// builder thenable -- pola yang sama dgn test service aset/settings).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCreateRecurringParams, toRecurringRecord,
  listRecurring, createRecurring, updateRecurring, deleteRecurring,
  setRecurringActive, advanceRecurringDueDate,
} from "../../src/services/supabase/recurring.js";
import { createMockSupabaseClient } from "./helpers/mock-supabase-client.js";

// requireClient() modul ini mengecek .rpc -- mock helper tidak punya; tambahkan
// stub (jadi tripwire: fungsi tabel TIDAK boleh memanggil rpc).
function mockClient(opts) {
  const mock = createMockSupabaseClient(opts);
  mock.rpc = () => { throw new Error("rpc() tidak boleh dipanggil operasi tabel recurring"); };
  return mock;
}

// ===================== normalizer =====================

test("toCreateRecurringParams: snake_case -> camelCase, jumlah dikersi Number, keterangan kosong -> null", () => {
  const params = toCreateRecurringParams({
    recurring_id: "rec-1", due_date: "2026-09-05", jenis: "Pengeluaran", jumlah: "54000",
    akun: "Bank BCA", kategori: "Hiburan", keterangan: "Netflix (otomatis berulang)",
  });
  assert.deepEqual(params, {
    recurringId: "rec-1", dueDate: "2026-09-05", jenis: "Pengeluaran", jumlah: 54000,
    akun: "Bank BCA", kategori: "Hiburan", keterangan: "Netflix (otomatis berulang)",
    mataUang: null, kurs: null, jumlahIdr: null,
  });
});

test("toRecurringRecord: jumlah string -> Number, keterangan '' -> null, end_date '' -> null", () => {
  const rec = toRecurringRecord({
    jenis: "Pemasukan", jumlah: "5000000", akun: "Bank BCA", kategori: "Gaji",
    keterangan: "", frequency: "bulanan", start_date: "2026-01-01", next_due_date: "2026-09-01", end_date: "",
  });
  assert.equal(rec.jumlah, 5000000);
  assert.equal(rec.keterangan, null);
  assert.equal(rec.end_date, null);
  assert.equal(rec.active, undefined); // active BUKAN bagian record update/insert mapping
});

// ===================== operasi tabel =====================

test("createRecurring(): insert dgn user_id, seluruh field record, & active: true", async () => {
  const client = mockClient({ result: { data: null, error: null } });
  await createRecurring(client, {
    jenis: "Pengeluaran", jumlah: "150000", akun: "GoPay", kategori: "Hiburan",
    keterangan: "Netflix", frequency: "bulanan", start_date: "2026-01-01", next_due_date: "2026-09-01", end_date: null,
  });
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.table, "recurring_transactions");
  assert.equal(call.method, "insert");
  assert.equal(call.payload.user_id, "user-1");
  assert.equal(call.payload.jumlah, 150000);
  assert.equal(call.payload.active, true);
  assert.equal(call.payload.next_due_date, "2026-09-01");
});

test("updateRecurring(): update dgn record lengkap (next_due_date ikut), filter by id + user_id (v56), TANPA active", async () => {
  const client = mockClient({ result: { data: null, error: null } });
  await updateRecurring(client, "rec-9", {
    jenis: "Pengeluaran", jumlah: 160000, akun: "GoPay", kategori: "Hiburan",
    keterangan: "Netflix", frequency: "bulanan", start_date: "2026-01-01", next_due_date: "2026-10-01", end_date: null,
  });
  const call = client.calls[0];
  assert.equal(call.method, "update");
  assert.equal(call.payload.jumlah, 160000);
  assert.equal(call.payload.next_due_date, "2026-10-01");
  assert.equal("active" in call.payload, false);
  assert.deepEqual(call.filters, [["id", "rec-9"], ["user_id", "user-1"]]);
});

test("deleteRecurring(): delete filter by id + user_id (defense-in-depth v56)", async () => {
  const client = mockClient({ result: { data: null, error: null } });
  await deleteRecurring(client, "rec-3");
  assert.equal(client.calls[0].method, "delete");
  assert.deepEqual(client.calls[0].filters, [["id", "rec-3"], ["user_id", "user-1"]]);
});

test("setRecurringActive(): update hanya { active } utk id + user_id (v56)", async () => {
  const client = mockClient({ result: { data: null, error: null } });
  await setRecurringActive(client, "rec-2", false);
  assert.equal(client.calls[0].method, "update");
  assert.deepEqual(client.calls[0].payload, { active: false });
  assert.deepEqual(client.calls[0].filters, [["id", "rec-2"], ["user_id", "user-1"]]);
});

test("advanceRecurringDueDate(): update hanya { next_due_date } utk id + user_id (v56)", async () => {
  const client = mockClient({ result: { data: null, error: null } });
  await advanceRecurringDueDate(client, "rec-4", "2026-10-05");
  assert.equal(client.calls[0].method, "update");
  assert.deepEqual(client.calls[0].payload, { next_due_date: "2026-10-05" });
  assert.deepEqual(client.calls[0].filters, [["id", "rec-4"], ["user_id", "user-1"]]);
});

test("operasi tabel: error PostgREST di-lempar (konvensi .catch pemanggil)", async () => {
  const client = mockClient({ result: { data: null, error: new Error("row-level security") } });
  await assert.rejects(() => setRecurringActive(client, "x", true), /row-level security/);
});

// ===================== listRecurring (paging) =====================

test("listRecurring(): kolom lengkap + urut next_due_date asc lalu id asc + range halaman pertama", async () => {
  const client = mockClient({ result: { data: [], error: null } });
  await listRecurring(client);
  const call = client.calls[0];
  assert.equal(call.table, "recurring_transactions");
  assert.equal(call.columns, "id, jenis, jumlah, akun, kategori, keterangan, frequency, start_date, next_due_date, end_date, active");
  assert.deepEqual(call.order, [["next_due_date", { ascending: true }], ["id", { ascending: true }]]);
  assert.deepEqual(call.range, [0, 999]);
});

test("listRecurring(): jumlah dinormalisasi ke Number (numeric Postgres string)", async () => {
  const client = mockClient({ result: { data: [{ id: "r1", jumlah: "54000", active: true }], error: null } });
  const rows = await listRecurring(client);
  assert.equal(rows[0].jumlah, 54000);
  assert.equal(typeof rows[0].jumlah, "number");
});

test("listRecurring(): halaman penuh -> lanjut halaman berikutnya sampai halaman pendek", async () => {
  let callNo = 0;
  const page = (n) => ({ data: n === 0 ? Array(1000).fill({ id: "r", jumlah: 1 }) : [{ id: "last", jumlah: 2 }], error: null });
  const client = mockClient({ resultProvider: () => page(callNo++) });
  const rows = await listRecurring(client);
  assert.equal(callNo, 2); // 2 halaman
  assert.equal(rows.length, 1001);
});
