// Test service Edge Function (src/services/supabase/edge.js) -- hasil pemindahan
// body suggestCategoryRemote/getExchangeRateRemote/scanReceiptRemote dari adapter
// `api` di index.html saat pensyahan api.run (slice edge functions). Dua lapis
// error adapter lama dipertahankan: error transport & data.error dari function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCategory, getExchangeRate, scanReceipt } from "../../src/services/supabase/edge.js";

function mockFunctionsClient(result) {
  const calls = [];
  return {
    calls,
    functions: {
      invoke(name, opts) { calls.push({ name, opts }); return Promise.resolve(result); },
    },
  };
}

test("getExchangeRate(): invoke 'get-exchange-rate' dgn body { mata_uang }", async () => {
  const client = mockFunctionsClient({ data: { rate: 15800, tanggal: "2026-08-30" }, error: null });
  const out = await getExchangeRate(client, "USD");
  assert.equal(client.calls[0].name, "get-exchange-rate");
  assert.deepEqual(client.calls[0].opts, { body: { mata_uang: "USD" } });
  assert.deepEqual(out, { rate: 15800, tanggal: "2026-08-30" });
});

test("suggestCategory(): invoke 'analyze-finance' dgn mode suggest_category + keterangan/jenis/categories", async () => {
  const client = mockFunctionsClient({ data: { kategori: "Makanan" }, error: null });
  const out = await suggestCategory(client, "nasi padang", "Pengeluaran", ["Makanan", "Transport"]);
  assert.equal(client.calls[0].name, "analyze-finance");
  assert.deepEqual(client.calls[0].opts, { body: { mode: "suggest_category", keterangan: "nasi padang", jenis: "Pengeluaran", categories: ["Makanan", "Transport"] } });
  assert.deepEqual(out, { kategori: "Makanan" });
});

test("scanReceipt(): invoke 'scan-receipt' dgn image_base64 + mime_type + categories", async () => {
  const client = mockFunctionsClient({ data: { keterangan: "kopi", jumlah: 25000 }, error: null });
  const out = await scanReceipt(client, "data:image/jpeg;base64,AAAA", "image/jpeg", ["Makanan"]);
  assert.equal(client.calls[0].name, "scan-receipt");
  assert.deepEqual(client.calls[0].opts, { body: { image_base64: "data:image/jpeg;base64,AAAA", mime_type: "image/jpeg", categories: ["Makanan"] } });
  assert.deepEqual(out, { keterangan: "kopi", jumlah: 25000 });
});

test("edge: error transport functions.invoke di-lempar", async () => {
  const client = mockFunctionsClient({ data: null, error: new Error("RelayClient: 542") });
  await assert.rejects(() => getExchangeRate(client, "USD"), /RelayClient/);
  await assert.rejects(() => suggestCategory(client, "x", "y", []), /RelayClient/);
  await assert.rejects(() => scanReceipt(client, "b", "t", []), /RelayClient/);
});

test("edge: data.error dari function diubah jadi throw dgn pesan server", async () => {
  const client = mockFunctionsClient({ data: { error: "Rate limit terlampaui" }, error: null });
  await assert.rejects(() => getExchangeRate(client, "USD"), /Rate limit terlampaui/);
});

test("edge: client tanpa functions.invoke ditolak requireClient", async () => {
  await assert.rejects(() => getExchangeRate({}, "USD"), /tidak tersedia/);
  await assert.rejects(() => suggestCategory(null, "a", "b", []), /tidak tersedia/);
});
