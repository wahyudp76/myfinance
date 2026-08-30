// Test normalizer payload transaksi (src/services/transactions.js & transfers.js)
// hasil pemindahan body addTransactionRemote/editTransactionRemote/
// createTransferTransactionRemote dari adapter `api` di index.html saat pensyahan
// api.run (slice transactions). Koersi PERSIS adapter lama -- form mengirim string,
// tabel butuh number & null yang benar.
import assert from "node:assert/strict";
import test from "node:test";
import { toCreateRecord, toUpdateRecord, createTransactionService } from "../../src/services/transactions.js";
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

// ===================== rantai: mapper -> service kirim persis payload lama =====================

function mockInsertClient() {
  const calls = [];
  const client = {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from(table) {
      calls.push({ table, op: null, payload: null });
      const cur = calls[calls.length - 1];
      const step = {
        insert(payload) { cur.op = "insert"; cur.payload = payload; return step2; },
        update(payload) { cur.op = "update"; cur.payload = payload; return step2; },
      };
      const step2 = {
        select() { return this; },
        single() { return Promise.resolve({ data: { id: "new-id" }, error: null }); },
        eq() { return this instanceof Promise ? this : Promise.resolve({ data: null, error: null }); },
      };
      return step;
    },
  };
  return client;
}

test("rantai: create(toCreateRecord(form)) mengirim insert dgn jumlah number & keterangan null -- persis alur adapter lama", async () => {
  const client = mockInsertClient();
  const svc = createTransactionService(client);
  await svc.create(toCreateRecord({
    jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: "11500",
    akun: "Tunai (Cash)", kategori: "Saldo Awal", keterangan: "",
  }));
  assert.equal(client.calls[0].table, "transactions");
  assert.equal(client.calls[0].op, "insert");
  const payload = client.calls[0].payload;
  assert.equal(payload.jumlah, 11500);
  assert.equal(payload.keterangan, null);
  assert.equal(payload.mata_uang, null);
  assert.equal(payload.kurs, 1); // service: data.kurs || 1 (null -> 1), sama seperti insert adapter lama
  assert.equal(payload.jumlah_idr, 11500);
  assert.equal(payload.user_id, "u1");
});
