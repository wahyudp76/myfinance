import { test } from "node:test";
import assert from "node:assert/strict";
import { listAssets, createAsset, updateAsset, deleteAsset, refreshAssetPrice } from "../../src/services/supabase/assets.js";
import { createMockSupabaseClient } from "./helpers/mock-supabase-client.js";

const RAW_ROW = {
  id: "a1", nama: "BTC", kategori: "Kripto", platform: "Pintu",
  modal: "15000000", nilai: "18500000", terakhir: "2026-08-20T00:00:00Z",
  value_history: [{ tanggal: "2026-08-20", nilai: 18500000 }],
  simbol: "BTC", jumlah_unit: "0.005", sumber_harga: "coingecko",
};

test("listAssets(): select mencakup 3 kolom refresh harga otomatis (simbol/jumlah_unit/sumber_harga)", async () => {
  const client = createMockSupabaseClient({ resultProvider: (record) => (record.range[0] === 0 ? { data: [RAW_ROW], error: null } : { data: [], error: null }) });
  await listAssets(client);

  const call = client.calls[0];
  assert.equal(call.table, "assets");
  for (const col of ["simbol", "jumlah_unit", "sumber_harga", "value_history", "modal", "nilai"]) {
    assert.ok(call.columns.includes(col), `select harus menyertakan kolom ${col}`);
  }
});

test("listAssets(): modal/nilai dikonversi ke Number (datang sebagai string numeric dari Postgres), value_history default array kosong", async () => {
  const rowWithoutHistory = { ...RAW_ROW, value_history: null };
  const client = createMockSupabaseClient({
    resultProvider: (record) => (record.range[0] === 0 ? { data: [rowWithoutHistory], error: null } : { data: [], error: null }),
  });
  const [asset] = await listAssets(client);

  assert.equal(typeof asset.modal, "number");
  assert.equal(asset.modal, 15000000);
  assert.equal(typeof asset.nilai, "number");
  assert.deepEqual(asset.value_history, []);
});

test("listAssets(): melempar error kalau salah satu halaman query gagal", async () => {
  const client = createMockSupabaseClient({ result: { data: null, error: new Error("timeout") } });
  await assert.rejects(() => listAssets(client), /timeout/);
});

test("createAsset(): insert menyertakan user_id + Number coercion modal/nilai, null default utk field opsional", async () => {
  const client = createMockSupabaseClient();
  await createAsset(client, { nama: "ETH", kategori: "Kripto", modal: "5000000", nilai: "6000000" });

  const call = client.calls[0];
  assert.equal(call.table, "assets");
  assert.equal(call.method, "insert");
  assert.equal(call.payload.user_id, "user-1");
  assert.equal(call.payload.modal, 5000000);
  assert.equal(call.payload.nilai, 6000000);
  assert.equal(call.payload.platform, null);
  assert.equal(call.payload.simbol, null);
  assert.equal(call.payload.jumlah_unit, null);
  assert.equal(call.payload.sumber_harga, null);
});

test("createAsset(): field refresh-harga-otomatis (simbol/jumlah_unit/sumber_harga) ikut terkirim kalau diisi", async () => {
  const client = createMockSupabaseClient();
  await createAsset(client, {
    nama: "BTC", kategori: "Kripto", modal: 100, nilai: 100,
    simbol: "BTC", jumlah_unit: 0.01, sumber_harga: "coingecko",
  });

  const call = client.calls[0];
  assert.equal(call.payload.simbol, "BTC");
  assert.equal(call.payload.jumlah_unit, 0.01);
  assert.equal(call.payload.sumber_harga, "coingecko");
});

test("updateAsset(): update difilter by id + user_id (defense-in-depth v56), menyertakan terakhir (timestamp refresh)", async () => {
  const client = createMockSupabaseClient();
  await updateAsset(client, "a1", { nama: "BTC", kategori: "Kripto", modal: 1, nilai: 2, value_history: [] });

  const call = client.calls[0];
  assert.equal(call.table, "assets");
  assert.equal(call.method, "update");
  assert.deepEqual(call.filters, [["id", "a1"], ["user_id", "user-1"]]);
  assert.ok(call.payload.terakhir, "terakhir harus diisi ulang saat update");
});

test("deleteAsset(): delete difilter by id + user_id (defense-in-depth v56)", async () => {
  const client = createMockSupabaseClient();
  await deleteAsset(client, "a1");

  const call = client.calls[0];
  assert.equal(call.table, "assets");
  assert.equal(call.method, "delete");
  assert.deepEqual(call.filters, [["id", "a1"], ["user_id", "user-1"]]);
});

// ===================== refreshAssetPrice (Edge Function) =====================
// Ditambah saat pensyahan api.run (slice assets): body refreshAssetPriceRemote()
// adapter `api` di index.html pindah ke sini. Dua lapis error adapter lama
// dipertahankan: error transport (functions.invoke) & error aplikasi (data.error).

function mockFunctionsClient(result) {
  const calls = [];
  return {
    calls,
    functions: {
      invoke(name, opts) { calls.push({ name, opts }); return Promise.resolve(result); },
    },
  };
}

test("refreshAssetPrice(): invoke 'refresh-asset-price' dgn body { asset_id }", async () => {
  const client = mockFunctionsClient({ data: { nilai_baru: 27800000 }, error: null });
  const out = await refreshAssetPrice(client, "asset-123");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "refresh-asset-price");
  assert.deepEqual(client.calls[0].opts, { body: { asset_id: "asset-123" } });
  assert.deepEqual(out, { nilai_baru: 27800000 });
});

test("refreshAssetPrice(): error transport dari functions.invoke di-lempar", async () => {
  const client = mockFunctionsClient({ data: null, error: new Error("FunctionsClient: 500") });
  await assert.rejects(() => refreshAssetPrice(client, "a1"), /FunctionsClient: 500/);
});

test("refreshAssetPrice(): data.error dari Edge Function diubah jadi throw (pesan server diteruskan)", async () => {
  const client = mockFunctionsClient({ data: { error: "Sumber harga tidak didukung" }, error: null });
  await assert.rejects(() => refreshAssetPrice(client, "a1"), /Sumber harga tidak didukung/);
});

test("refreshAssetPrice(): client null ditolak requireClient", async () => {
  await assert.rejects(() => refreshAssetPrice(null, "a1"), /belum diberikan/);
});
