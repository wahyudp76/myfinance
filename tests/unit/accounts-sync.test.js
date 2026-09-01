// Unit test syncAccountsFromTransactions (src/domain/asset-flows.js) --
// pendaftaran akun baru + self-heal nama aset bayangan, dipakai refresh penuh
// DAN echo lokal pasca-simpan supaya perilakunya identik.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccountsFromTransactions } from "../../src/domain/asset-flows.js";

test("akun baru dari baris transaksi didaftarkan, yang sudah ada tidak dobel", () => {
  const r = syncAccountsFromTransactions({
    accounts: ["Cash"],
    transactions: [
      { akun: "Cash", jenis: "Pengeluaran", kategori: "Makan" },
      { akun: "Bank BCA", jenis: "Pemasukan", kategori: "Gaji" },
      { akun: "Bank BCA", jenis: "Pemasukan", kategori: "Gaji" },
    ],
    assets: [],
  });
  assert.deepEqual(r.accounts.sort(), ["Bank BCA", "Cash"]);
  assert.deepEqual(r.added, ["Bank BCA"]);
  assert.deepEqual(r.shadowNames, []);
});

test("kategori tujuan Transfer didaftarkan sebagai akun KECUALI nama aset yang dikenal", () => {
  const r = syncAccountsFromTransactions({
    accounts: ["Cash"],
    transactions: [
      { akun: "Cash", jenis: "Transfer", kategori: "GoPay" },
      { akun: "Cash", jenis: "Transfer", kategori: "Bibit" },
    ],
    assets: [{ id: "a1", nama: "Bibit" }],
  });
  assert.ok(r.accounts.includes("GoPay"), "tujuan transfer non-aset = akun");
  assert.ok(!r.accounts.includes("Bibit"), "nama aset dikenal tidak didaftarkan sebagai akun");
  assert.deepEqual(r.added, ["GoPay"]);
});

test("self-heal: nama aset bayangan (jejak Transfer-tujuan, tak pernah jadi akun) dipangkas", () => {
  const r = syncAccountsFromTransactions({
    accounts: ["Cash", "Bibit"],
    transactions: [{ akun: "Cash", jenis: "Transfer", kategori: "Bibit" }],
    assets: [{ id: "a1", nama: "Bibit" }],
  });
  assert.deepEqual(r.accounts, ["Cash"]);
  assert.deepEqual(r.shadowNames, ["Bibit"]);
});

test("self-heal: nama yang dipakai sebagai akun di transaksi apapun TIDAK dipangkas", () => {
  const r = syncAccountsFromTransactions({
    accounts: ["Cash", "Bibit"],
    transactions: [
      { akun: "Cash", jenis: "Transfer", kategori: "Bibit" },
      { akun: "Bibit", jenis: "Pengeluaran", kategori: "Makan" },
    ],
    assets: [{ id: "a1", nama: "Bibit" }],
  });
  assert.deepEqual(r.accounts.sort(), ["Bibit", "Cash"]);
  assert.deepEqual(r.shadowNames, []);
});

test("input kosong -> accounts tidak berubah, tidak melempar", () => {
  const r = syncAccountsFromTransactions({ accounts: ["Cash"], transactions: [], assets: [] });
  assert.deepEqual(r.accounts, ["Cash"]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.shadowNames, []);
});

test("arrays tidak dimutasi (murni), urutan akun lama dipertahankan", () => {
  const accounts = ["Cash", "GoPay"];
  const r = syncAccountsFromTransactions({
    accounts,
    transactions: [{ akun: "Bank", jenis: "Pemasukan", kategori: "Gaji" }],
    assets: [],
  });
  assert.deepEqual(accounts, ["Cash", "GoPay"]);
  assert.deepEqual(r.accounts, ["Cash", "GoPay", "Bank"]);
});
