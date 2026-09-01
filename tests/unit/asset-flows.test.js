// Unit test domain asset-flows (src/domain/asset-flows.js) -- murni, tanpa DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAssetDeposit, findAssetByName, resolveAssetDepositTx, pruneAssetShadowAccounts } from "../../src/domain/asset-flows.js";

const BIBIT = { id: "a1", nama: "Bibit", kategori: "Reksadana", modal: 1000000, nilai: 1100000, value_history: [{ tanggal: "2026-08-01", nilai: 1100000 }] };

test("applyAssetDeposit: setor menambah nilai + modal dan upsert titik riwayat", () => {
  const r = applyAssetDeposit(BIBIT, 500000, "2026-08-15");
  assert.equal(r.nilai, 1600000);
  assert.equal(r.modal, 1500000);
  assert.deepEqual(r.value_history, [
    { tanggal: "2026-08-01", nilai: 1100000 },
    { tanggal: "2026-08-15", nilai: 1600000 }
  ]);
});

test("applyAssetDeposit: tanggal sama dgn titik riwayat -> nilai titik di-update (bukan duplikat)", () => {
  const r = applyAssetDeposit(BIBIT, 200000, "2026-08-01");
  assert.equal(r.value_history.length, 1);
  assert.deepEqual(r.value_history[0], { tanggal: "2026-08-01", nilai: 1300000 });
});

test("applyAssetDeposit: pembalikan (jumlah negatif) menarik nilai+modal, clamp >= 0", () => {
  const r = applyAssetDeposit(BIBIT, -1100000, "2026-08-20");
  assert.equal(r.nilai, 0);
  assert.equal(r.modal, 0);
  assert.equal(r.value_history.at(-1).nilai, 0);
  const r2 = applyAssetDeposit({ nilai: 50000, modal: 50000, value_history: [] }, -999999, null);
  assert.equal(r2.nilai, 0);
  assert.equal(r2.modal, 0);
  assert.deepEqual(r2.value_history, []); // tanggal null -> riwayat tak disentuh
});

test("applyAssetDeposit: aset tanpa value_history / tanggal ISO panjang tetap aman", () => {
  const r = applyAssetDeposit({ nama: "X", nilai: 0, modal: 0 }, 25000, "2026-09-01T10:00:00Z");
  assert.deepEqual(r.value_history, [{ tanggal: "2026-09-01", nilai: 25000 }]);
  assert.equal(r.nilai, 25000);
  assert.equal(r.modal, 25000);
});

test("findAssetByName: case-insensitive + trim; null utk input rusak", () => {
  assert.equal(findAssetByName([BIBIT], "bibit").id, "a1");
  assert.equal(findAssetByName([BIBIT], "  BIBIT ").id, "a1");
  assert.equal(findAssetByName([BIBIT], "Saham XYZ"), null);
  assert.equal(findAssetByName(null, "Bibit"), null);
  assert.equal(findAssetByName([BIBIT], ""), null);
});

test("resolveAssetDepositTx: hanya Transfer dgn kategori = nama aset", () => {
  assert.equal(resolveAssetDepositTx({ jenis: "Transfer", kategori: "Bibit" }, [BIBIT]).id, "a1");
  assert.equal(resolveAssetDepositTx({ jenis: "Transfer", kategori: "BCA" }, [BIBIT]), null);
  assert.equal(resolveAssetDepositTx({ jenis: "Pengeluaran", kategori: "Bibit" }, [BIBIT]), null);
  assert.equal(resolveAssetDepositTx(null, [BIBIT]), null);
});

test("pruneAssetShadowAccounts: buang akun-bayangan aset, amankan akun sah", () => {
  const assets = [{ id: "a9", nama: "Shopee Merchant" }];
  const txs = [
    { jenis: "Transfer", kategori: "shopee merchant", akun: "BCA", jumlah: "100000" },
    { jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", jumlah: "20000" },
  ];
  // kasus bug: nama aset terdaftar sebagai akun padahal tak pernah jadi akun transaksi
  const r1 = pruneAssetShadowAccounts({ accounts: ["BCA", "Shopee Merchant"], transactions: txs, assets });
  assert.deepEqual(r1, ["Shopee Merchant"]);
  // akun yang benar-benar dipakai transaksi TIDAK disentuh walau sama dgn nama aset
  const r2 = pruneAssetShadowAccounts({ accounts: ["BCA", "Shopee Merchant"], transactions: [...txs, { jenis: "Pemasukan", kategori: "x", akun: "Shopee Merchant", jumlah: "5" }], assets });
  assert.deepEqual(r2, []);
  // akun nganggur tanpa jejak transfer-tujuan TIDAK disentuh (bukan bayangan)
  const r3 = pruneAssetShadowAccounts({ accounts: ["Shopee Merchant"], transactions: [{ jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", jumlah: "1" }], assets });
  assert.deepEqual(r3, []);
  // nama bukan aset TIDAK disentuh
  const r4 = pruneAssetShadowAccounts({ accounts: ["Tunai"], transactions: txs, assets });
  assert.deepEqual(r4, []);
});
