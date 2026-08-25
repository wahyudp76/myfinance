import { test } from "node:test";
import assert from "node:assert/strict";
import { getSettings, saveSettings } from "../../src/services/supabase/settings.js";
import { createMockSupabaseClient } from "./helpers/mock-supabase-client.js";

test("getSettings(): query tabel settings, kolom data, single row", async () => {
  const client = createMockSupabaseClient({ result: { data: { data: { accounts: ["Cash"] } }, error: null } });
  const result = await getSettings(client);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].table, "settings");
  assert.equal(client.calls[0].columns, "data");
  assert.equal(client.calls[0].single, true);
  assert.deepEqual(result, { accounts: ["Cash"] });
});

test("getSettings(): user baru (belum pernah simpan pengaturan) -> null, BUKAN error atau object kosong", () => {
  const client = createMockSupabaseClient({ result: { data: null, error: null } });
  return getSettings(client).then((result) => {
    assert.equal(result, null);
  });
});

test("getSettings(): melempar error kalau query gagal", async () => {
  const client = createMockSupabaseClient({ result: { data: null, error: new Error("network down") } });
  await assert.rejects(() => getSettings(client), /network down/);
});

test("saveSettings(): upsert ke tabel settings dgn onConflict user_id, membawa objek pengaturan apa adanya", async () => {
  const client = createMockSupabaseClient();
  const settingsObj = { accounts: ["Cash", "Bank BCA"], debts: [{ id: "debt_1", nama: "KPR" }] };
  await saveSettings(client, settingsObj);

  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.table, "settings");
  assert.equal(call.method, "upsert");
  assert.equal(call.options.onConflict, "user_id");
  assert.equal(call.payload.user_id, "user-1");
  assert.deepEqual(call.payload.data, settingsObj);
  assert.ok(call.payload.updated_at, "updated_at harus diisi");
});

test("saveSettings(): melempar error kalau upsert gagal", async () => {
  const client = createMockSupabaseClient({ result: { data: null, error: new Error("RLS violation") } });
  await assert.rejects(() => saveSettings(client, {}), /RLS violation/);
});
