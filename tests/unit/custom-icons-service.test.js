import { test } from "node:test";
import assert from "node:assert/strict";
import { getCustomIcons, saveCustomIcon, deleteCustomIcon } from "../../src/services/supabase/custom-icons.js";
import { createMockSupabaseClient } from "./helpers/mock-supabase-client.js";

test("getCustomIcons(): mengubah baris (account_name, icon_data) jadi peta nama -> data ikon", async () => {
  const rows = [
    { account_name: "Cash", icon_data: { type: "icon", value: "fa-wallet" } },
    { account_name: "Bank BCA", icon_data: { type: "image", value: "https://x/y.png" } },
  ];
  const client = createMockSupabaseClient({ result: { data: rows, error: null } });
  const result = await getCustomIcons(client);

  assert.equal(client.calls[0].table, "custom_icons");
  assert.equal(client.calls[0].columns, "account_name, icon_data");
  assert.deepEqual(result, {
    Cash: { type: "icon", value: "fa-wallet" },
    "Bank BCA": { type: "image", value: "https://x/y.png" },
  });
});

test("getCustomIcons(): tidak ada baris sama sekali -> object kosong, bukan error", async () => {
  const client = createMockSupabaseClient({ result: { data: null, error: null } });
  const result = await getCustomIcons(client);
  assert.deepEqual(result, {});
});

test("saveCustomIcon(): upsert dgn onConflict user_id,account_name (komposit)", async () => {
  const client = createMockSupabaseClient();
  await saveCustomIcon(client, "Bank BCA", { type: "icon", value: "fa-university" });

  const call = client.calls[0];
  assert.equal(call.table, "custom_icons");
  assert.equal(call.method, "upsert");
  assert.equal(call.options.onConflict, "user_id,account_name");
  assert.equal(call.payload.user_id, "user-1");
  assert.equal(call.payload.account_name, "Bank BCA");
  assert.deepEqual(call.payload.icon_data, { type: "icon", value: "fa-university" });
});

test("deleteCustomIcon(): delete difilter by account_name + user_id (defense-in-depth v56)", async () => {
  const client = createMockSupabaseClient();
  await deleteCustomIcon(client, "Bank BCA");

  const call = client.calls[0];
  assert.equal(call.table, "custom_icons");
  assert.equal(call.method, "delete");
  assert.deepEqual(call.filters, [["account_name", "Bank BCA"], ["user_id", "user-1"]]);
});
