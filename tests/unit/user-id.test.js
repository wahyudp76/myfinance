// Unit test resolver user_id bersama (src/services/user-id.js) -- jalur cepat
// getSession() lokal harus menghemat 1 round-trip jaringan per operasi tulis,
// dengan fallback getUser() yang perilakunya identik dengan versi lama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getCurrentUserId } from "../../src/services/user-id.js";

function makeClient({ session = null, getUserError = false, user = { id: "u1" } } = {}) {
  const log = { getSession: 0, getUser: 0 };
  return {
    log,
    auth: {
      async getSession() {
        log.getSession += 1;
        return { data: { session }, error: null };
      },
      async getUser() {
        log.getUser += 1;
        if (getUserError) return { data: { user: null }, error: new Error("bad token") };
        return { data: { user }, error: null };
      },
    },
  };
}

test("sesi lokal valid -> user_id dari sesi, getUser() TIDAK dipanggil (hemat 1 RTT)", async () => {
  const client = makeClient({ session: { user: { id: "u-abc" }, expires_at: Math.floor(Date.now() / 1000) + 3600 } });
  const id = await getCurrentUserId(client);
  assert.equal(id, "u-abc");
  assert.equal(client.log.getSession, 1);
  assert.equal(client.log.getUser, 0);
});

test("sesi tanpa expires_at -> tetap dipakai (nilai null dianggap selalu berlaku)", async () => {
  const client = makeClient({ session: { user: { id: "u-x" }, expires_at: null } });
  const id = await getCurrentUserId(client);
  assert.equal(id, "u-x");
  assert.equal(client.log.getUser, 0);
});

test("sesi kedaluwarsa (< 30 detik lagi) -> fallback getUser()", async () => {
  const client = makeClient({ session: { user: { id: "u-old" }, expires_at: Math.floor(Date.now() / 1000) + 5 } });
  const id = await getCurrentUserId(client);
  assert.equal(id, "u1");
  assert.equal(client.log.getUser, 1);
});

test("sesi hilang (null) -> fallback getUser()", async () => {
  const client = makeClient({ session: null, user: { id: "u-fb" } });
  const id = await getCurrentUserId(client);
  assert.equal(id, "u-fb");
  assert.equal(client.log.getUser, 1);
});

test("getUser() gagal -> melempar pesan sesi tidak ditemukan (sama seperti versi lama)", async () => {
  const client = makeClient({ session: null, getUserError: true });
  await assert.rejects(() => getCurrentUserId(client), /Sesi login tidak ditemukan/);
});

test("client minimal TANPA getSession (mock lama) -> fallback getUser() tetap jalan", async () => {
  const client = { auth: { async getUser() { return { data: { user: { id: "u-legacy" } }, error: null }; } } };
  const id = await getCurrentUserId(client);
  assert.equal(id, "u-legacy");
});

test("client null -> melempar error client belum diberikan", async () => {
  await assert.rejects(() => getCurrentUserId(null), /Supabase client belum diberikan/);
});
