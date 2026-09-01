// Test normalizer payload transaksi (src/services/transactions.js & transfers.js)
// hasil pemindahan body addTransactionRemote/editTransactionRemote/
// createTransferTransactionRemote dari adapter `api` di index.html saat pensyahan
// api.run (slice transactions). Koersi PERSIS adapter lama -- form mengirim string,
// tabel butuh number & null yang benar.
import assert from "node:assert/strict";
import test from "node:test";
import { toCreateRecord, toUpdateRecord, createTransactionService, mapTransactionRow } from "../../src/services/transactions.js";
import { toTransferParams } from "../../src/services/supabase/transfers.js";

// ===================== toCreateRecord =====================

test("toCreateRecord: jumlah string -> Number; keterangan/mata_uang kosong -> null; jumlah_idr fallback ke jumlah", () => {
  const rec = toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "11500",
    akun: "Tunai (Cash)", kategori: "Saldo Awal", keterangan: "",
  });
  assert.deepEqual(rec, {
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: 11500,
    akun: "Tunai (Cash)", kategori: "Saldo Awal", keterangan: null,
    mata_uang: null, kurs: null, jumlah_idr: 11500,
  });
  assert.equal(typeof rec.jumlah, "number");
  assert.equal(typeof rec.jumlah_idr, "number");
});

test("toCreateRecord: transaksi valuta asing -- mata_uang/kurs/jumlah_idr diteruskan (jumlah_idr string dikersi)", () => {
  const rec = toCreateRecord({
    jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: "10",
    akun: "USD Card", kategori: "Makanan", keterangan: "coffee",
    mata_uang: "USD", kurs: "15800", jumlah_idr: "158000",
  });
  assert.equal(rec.mata_uang, "USD");
  // kurs SENGAJA tidak dikersi Number -- adapter lama meneruskannya apa adanya
  // (Number() cuma utk jumlah & jumlah_idr); nilai live dari API kurs memang number.
  assert.equal(rec.kurs, "15800");
  assert.equal(rec.jumlah_idr, 158000);
  assert.equal(rec.keterangan, "coffee");
});

test("toCreateRecord: jumlah_idr 0 tetap 0 (bukan fallback ke jumlah)", () => {
  const rec = toCreateRecord({ jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: "5", akun: "A", kategori: "B", keterangan: null, jumlah_idr: 0 });
  assert.equal(rec.jumlah_idr, 0);
});

// ===================== toUpdateRecord =====================

test("toUpdateRecord: 4 kolom sisi tujuan transfer undefined -> null (transaksi non-Transfer)", () => {
  const rec = toUpdateRecord({ jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: "25000", akun: "A", kategori: "B", keterangan: "x" });
  assert.equal(rec.transfer_jumlah_tujuan, null);
  assert.equal(rec.transfer_mata_uang_tujuan, null);
  assert.equal(rec.transfer_kurs_tujuan, null);
  assert.equal(rec.transfer_jumlah_tujuan_idr, null);
  assert.equal(rec.jumlah, 25000);
});

test("toUpdateRecord: edit Transfer lintas mata uang -- nilai tujuan dikersi Number & diteruskan", () => {
  const rec = toUpdateRecord({
    jenis: "Transfer", tanggal: "2026-08-30", jumlah: "100", akun: "USD Card", kategori: "GoPay", keterangan: "",
    mata_uang: "USD", kurs: 15800, jumlah_idr: 1580000,
    transfer_jumlah_tujuan: "1580000", transfer_mata_uang_tujuan: "IDR",
    transfer_kurs_tujuan: "1", transfer_jumlah_tujuan_idr: "1580000",
  });
  assert.equal(rec.keterangan, null); // "" -> null
  assert.equal(rec.transfer_jumlah_tujuan, 1580000);
  assert.equal(rec.transfer_mata_uang_tujuan, "IDR");
  assert.equal(rec.transfer_kurs_tujuan, 1);
  assert.equal(rec.transfer_jumlah_tujuan_idr, 1580000);
});

// ===================== toTransferParams =====================

test("toTransferParams: mapping lengkap -- kurs kosong default 1, mata uang kosong null, jumlah dikersi", () => {
  const params = toTransferParams({
    tanggal: "2026-08-30", jumlah: "50000", akun_sumber: "Bank BCA", akun_tujuan: "GoPay",
    mata_uang_sumber: null, mata_uang_tujuan: null, kurs_sumber: null, kurs_tujuan: null,
    keterangan: "",
  });
  assert.deepEqual(params, {
    tanggal: "2026-08-30", sourceAmount: 50000, sourceAccount: "Bank BCA", destinationAccount: "GoPay",
    sourceCurrency: null, destinationCurrency: null, sourceRateIdrPerUnit: 1, destinationRateIdrPerUnit: 1,
    description: null,
  });
});

test("toTransferParams: lintas mata uang -- semua nilai diteruskan apa adanya (kurs angka)", () => {
  const params = toTransferParams({
    tanggal: "2026-08-30", jumlah: 100, akun_sumber: "USD Card", akun_tujuan: "GoPay",
    mata_uang_sumber: "USD", mata_uang_tujuan: "IDR", kurs_sumber: 15800, kurs_tujuan: 1,
    keterangan: "top up",
  });
  assert.equal(params.sourceAmount, 100);
  assert.equal(params.sourceCurrency, "USD");
  assert.equal(params.destinationCurrency, "IDR");
  assert.equal(params.sourceRateIdrPerUnit, 15800);
  assert.equal(params.description, "top up");
});

// ===================== mock client Supabase (chainable) =====================
// Meniru perilaku yang dipakai service: insert().select().single() /
// update().eq().eq().select().maybeSingle() / delete().eq().eq().
// auth.getSession() menyediakan sesi lokal (user u1) -- jalur CEPAT tanpa
// jaringan; auth.getUser() hanya dipanggil sebagai fallback.

const INSERTED_ROW = {
  id: "new-id", jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "11500",
  akun: "Tunai (Cash)", kategori: "Saldo Awal", keterangan: null,
  mata_uang: null, kurs: 1, jumlah_idr: "11500",
  transfer_jumlah_tujuan: null, transfer_mata_uang_tujuan: null,
  transfer_kurs_tujuan: null, transfer_jumlah_tujuan_idr: null,
};

function mockSupabaseClient({ noSession = false, updateRow = INSERTED_ROW, getUserError = false } = {}) {
  const log = { getSession: 0, getUser: 0, ops: [] };
  const chain = {
    then(onFulfilled) { return Promise.resolve({ data: null, error: null }).then(onFulfilled); },
    insert(payload) { const cur = log.ops[log.ops.length - 1]; cur.op = "insert"; cur.payload = payload; return chain; },
    update(payload) { const cur = log.ops[log.ops.length - 1]; cur.op = "update"; cur.payload = payload; return chain; },
    delete() { const cur = log.ops[log.ops.length - 1]; cur.op = "delete"; cur.payload = null; return chain; },
    eq() { chain.eqCount = (chain.eqCount || 0) + 1; return chain; },
    select() { return chain; },
    range() { return chain; },
    order() { return chain; },
    single() { return Promise.resolve({ data: updateRow, error: null }); },
    maybeSingle() { return Promise.resolve({ data: updateRow, error: null }); },
  };
  const client = {
    log,
    auth: {
      async getSession() {
        log.getSession += 1;
        if (noSession) return { data: { session: null }, error: null };
        return {
          data: { session: { user: { id: "u1" }, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
          error: null,
        };
      },
      async getUser() {
        log.getUser += 1;
        if (getUserError) return { data: { user: null }, error: new Error("invalid token") };
        return { data: { user: { id: "u1" } }, error: null };
      },
    },
    from(table) {
      log.ops.push({ table, op: null, payload: null });
      return chain;
    },
  };
  return { client, log };
}

// ===================== rantai: mapper -> service kirim persis payload lama =====================

test("rantai: create(toCreateRecord(form)) mengirim insert dgn jumlah number & keterangan null -- persis alur adapter lama", async () => {
  const { client, log } = mockSupabaseClient();
  const svc = createTransactionService(client);
  await svc.create(toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "11500",
    akun: "Tunai (Cash)", kategori: "Saldo Awal", keterangan: "",
  }));
  assert.equal(log.ops[0].table, "transactions");
  assert.equal(log.ops[0].op, "insert");
  const payload = log.ops[0].payload;
  assert.equal(payload.jumlah, 11500);
  assert.equal(payload.keterangan, null);
  assert.equal(payload.mata_uang, null);
  assert.equal(payload.kurs, 1); // service: data.kurs || 1 (null -> 1), sama seperti insert adapter lama
  assert.equal(payload.jumlah_idr, 11500);
  assert.equal(payload.user_id, "u1");
  // Jalur cepat: user_id dari sesi LOKAL -- tidak boleh ada panggilan getUser().
  assert.equal(log.getUser, 0, "getUser() tidak boleh dipanggil ketika sesi lokal masih berlaku");
  assert.equal(log.getSession, 1);
});

test("create: mengembalikan baris kanonik (mapTransactionRow) untuk echo lokal pasca-simpan", async () => {
  const { client } = mockSupabaseClient();
  const svc = createTransactionService(client);
  const row = await svc.create(toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "11500", akun: "A", kategori: "B", keterangan: "",
  }));
  assert.equal(row.id, "new-id");
  assert.equal(typeof row.jumlah, "number");
  assert.equal(row.jumlah, 11500); // jumlah_idr string dari PostgREST -> Number
  assert.equal(typeof row.jumlah_idr, "number");
});

test("create: fallback ke getUser() saat sesi lokal tidak ada (getSession -> null)", async () => {
  const { client, log } = mockSupabaseClient({ noSession: true });
  const svc = createTransactionService(client);
  const row = await svc.create(toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "5", akun: "A", kategori: "B", keterangan: null,
  }));
  assert.equal(row.id, "new-id");
  assert.equal(log.getUser, 1, "fallback getUser() dipanggil");
  assert.equal(log.getSession, 1);
});

test("create: sesi lokal kedaluwarsa -> fallback getUser() (token tinggal < 30 detik tidak dipakai)", async () => {
  const { client, log } = mockSupabaseClient();
  // Override sesi: expires_at hampir lewat.
  client.auth.getSession = async () => ({
    data: { session: { user: { id: "u1" }, expires_at: Math.floor(Date.now() / 1000) + 5 } },
    error: null,
  });
  const svc = createTransactionService(client);
  const row = await svc.create(toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "5", akun: "A", kategori: "B", keterangan: null,
  }));
  assert.equal(row.id, "new-id");
  assert.equal(log.getUser, 1);
});

test("create: getUser() error tetap melempar pesan sesi tidak ditemukan (perilaku lama)", async () => {
  const { client } = mockSupabaseClient({ noSession: true, getUserError: true });
  const svc = createTransactionService(client);
  await assert.rejects(
    () => svc.create(toCreateRecord({ jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "5", akun: "A", kategori: "B", keterangan: null })),
    /Sesi login tidak ditemukan/
  );
});

test("update: mengembalikan baris hasil update (select().maybeSingle()) untuk echo lokal", async () => {
  const { client, log } = mockSupabaseClient({ updateRow: { ...INSERTED_ROW, id: "tx-9", jumlah: "25000" } });
  const svc = createTransactionService(client);
  const row = await svc.update("tx-9", toUpdateRecord({
    jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: "25000", akun: "A", kategori: "B", keterangan: "",
  }));
  assert.equal(row.id, "tx-9");
  assert.equal(row.jumlah, 25000);
  assert.equal(log.ops[0].op, "update");
  assert.equal(log.getUser, 0);
});

test("update: baris tidak ketemu -> mengembalikan null (BUKAN error) -- perilaku update lama tetap", async () => {
  const { client } = mockSupabaseClient({ updateRow: null });
  const svc = createTransactionService(client);
  const row = await svc.update("missing-id", toUpdateRecord({
    jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: "1", akun: "A", kategori: "B", keterangan: "",
  }));
  assert.equal(row, null);
});

test("remove: delete().eq(id).eq(user_id) -- sama seperti dulu, user_id dari sesi lokal", async () => {
  const { client, log } = mockSupabaseClient();
  const svc = createTransactionService(client);
  await svc.remove("tx-1");
  assert.equal(log.ops[0].op, "delete");
  assert.equal(log.getUser, 0);
});

test("mapTransactionRow: kolom null dipertahankan null, kolom nominal dikersi Number", () => {
  const row = mapTransactionRow({
    id: "x", tanggal: "2026-08-30", jumlah: "100", jumlah_idr: null,
    transfer_jumlah_tujuan: null, transfer_kurs_tujuan: "2", transfer_jumlah_tujuan_idr: "500",
    transfer_mata_uang_tujuan: "USD",
  });
  assert.equal(row.jumlah, 100);
  assert.equal(row.jumlah_idr, null);
  assert.equal(row.transfer_jumlah_tujuan, null);
  assert.equal(row.transfer_kurs_tujuan, 2);
  assert.equal(row.transfer_jumlah_tujuan_idr, 500);
  assert.equal(row.transfer_mata_uang_tujuan, "USD");
  assert.equal(mapTransactionRow(null), null);
});
