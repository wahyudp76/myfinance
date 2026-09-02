// Kontrak paging PARALEL (v55 utk transaksi; v56 dilebur ke modul bersama
// src/services/supabase/paging.js & dipakai JUGA oleh listAssets/listRecurring):
// - halaman pertama + count=exact dalam 1 request;
// - sisa halaman di-fetch paralel (batch berbatas) bila count tersedia;
// - fallback loop BERURUTAN bila count tidak tersedia (mock/proxy lama);
// - urutan hasil identik dengan fetch berurutan (halaman diurutkan query);
// - error di halaman manapun melempar (tidak diam-diam memotong data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransactionService } from "../../src/services/transactions.js";
import { listAssets } from "../../src/services/supabase/assets.js";
import { listRecurring } from "../../src/services/supabase/recurring.js";

/**
 * Mock Supabase chain yang meniru postgrest-js secukupnya:
 * select(cols, {count}) -> order() xN -> range(from, to) -> thenable.
 * Mencatat tiap request, melacak inflight maksimum (bukti paralel vs berurutan),
 * dan mengembalikan `count` hanya bila diminta (Prefer: count=exact).
 */
function mockPagedClient(totalRows, { withCount = true, failFrom = null } = {}) {
  const requests = [];
  let inflight = 0;
  let maxInflight = 0;
  const client = {
    requests,
    // listAssets/listRecurring/list transaksi tidak boleh menyentuh rpc -- kalau
    // ada yang terpanggil, biarkan errornya eksplisit (bukan silent pass).
    rpc: () => {
      throw new Error("rpc() tidak boleh dipanggil pada kontrak paging");
    },
    get maxInflight() {
      return maxInflight;
    },
    from(table) {
      const q = { from: null, to: null, countExact: false, table };
      const range = (from, to) => {
        q.from = from;
        q.to = to;
        requests.push({ from, to, countExact: q.countExact, table: q.table });
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        return {
          then(onFulfilled, onRejected) {
            return Promise.resolve().then(() => {
              inflight -= 1;
              if (failFrom !== null && from === failFrom) {
                if (onRejected) return onRejected(new Error(`gagal di halaman ${from}`));
                return onFulfilled({ data: null, error: { message: `gagal di halaman ${from}` } });
              }
              const slice = [];
              for (let i = from; i <= to && i < totalRows; i += 1) {
                slice.push({ id: `t-${i}`, nama: `row-${i}` });
              }
              onFulfilled({ data: slice, error: null, count: withCount ? totalRows : undefined });
            });
          },
        };
      };
      return {
        select(_cols, opts) {
          q.countExact = !!(opts && opts.count === "exact");
          return this;
        },
        order() {
          return this;
        },
        range,
      };
    },
  };
  return client;
}

const SERVICE = (client) => createTransactionService(client);

test("list: <= 1000 baris -> 1 request (dgn count), tidak ada request kosong", async () => {
  const client = mockPagedClient(999);
  const rows = await SERVICE(client).list();
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].countExact, true);
  assert.equal(rows.length, 999);
});

test("list: TEPAT 1000 baris -> 1 request (tidak minta halaman 2 kosong)", async () => {
  const client = mockPagedClient(1000);
  const rows = await SERVICE(client).list();
  assert.equal(client.requests.length, 1);
  assert.equal(rows.length, 1000);
});

test("list: 2500 baris -> 3 request, sisa halaman PARALEL, urut & lengkap", async () => {
  const client = mockPagedClient(2500);
  const rows = await SERVICE(client).list();
  assert.equal(client.requests.length, 3);
  // Halaman 1 & 2 berjalan bersamaan (batch), bukan berurutan.
  assert.ok(client.maxInflight >= 2, `maxInflight=${client.maxInflight}, harap >= 2`);
  // Hanya halaman pertama yang minta count.
  assert.equal(client.requests[0].countExact, true);
  assert.equal(client.requests[1].countExact, false);
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, "t-0");
  assert.equal(rows[2499].id, "t-2499");
});

test("list: 2501 baris -> 3 request (halaman terakhir sisa 1 baris)", async () => {
  const client = mockPagedClient(2501);
  const rows = await SERVICE(client).list();
  assert.equal(client.requests.length, 3);
  assert.equal(client.requests[2].from, 2000);
  assert.equal(rows.length, 2501);
  assert.equal(rows.at(-1).id, "t-2500");
});

test("list: count TIDAK tersedia -> fallback loop BERURUTAN (perilaku lama)", async () => {
  const client = mockPagedClient(4500, { withCount: false });
  const rows = await SERVICE(client).list();
  // 5 halaman (4000-4999 kosong -> berhenti), berurutan.
  assert.equal(client.requests.length, 5);
  assert.equal(client.maxInflight, 1);
  assert.equal(rows.length, 4500);
});

test("list: error di halaman paralel -> melempar (tidak diam-diam potong data)", async () => {
  const client = mockPagedClient(2500, { failFrom: 1000 });
  await assert.rejects(() => SERVICE(client).list(), /gagal di halaman 1000/);
});

// ============ v56: paging paralel kini modul BERSAMA (assets & recurring) ============

test("listAssets: 2500 baris -> halaman pertama + count=exact, sisa PARALEL, urut & lengkap", async () => {
  const client = mockPagedClient(2500);
  const rows = await listAssets(client);
  assert.equal(client.requests.length, 3);
  assert.ok(client.requests.every((r) => r.table === "assets"), "semua request harus ke tabel assets");
  assert.ok(client.maxInflight >= 2, `maxInflight=${client.maxInflight}, harap >= 2`);
  assert.equal(client.requests[0].countExact, true);
  assert.equal(client.requests[1].countExact, false);
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, "t-0");
  assert.equal(rows[2499].id, "t-2499");
});

test("listAssets: count TIDAK tersedia -> fallback loop BERURUTAN (perilaku lama)", async () => {
  const client = mockPagedClient(4500, { withCount: false });
  const rows = await listAssets(client);
  assert.equal(client.requests.length, 5);
  assert.equal(client.maxInflight, 1);
  assert.equal(rows.length, 4500);
});

test("listAssets: error di halaman -> melempar (tidak diam-diam potong data)", async () => {
  const client = mockPagedClient(2500, { failFrom: 1000 });
  await assert.rejects(() => listAssets(client), /gagal di halaman 1000/);
});

test("listRecurring: 2500 baris -> halaman pertama + count=exact, sisa PARALEL, urut & lengkap", async () => {
  const client = mockPagedClient(2500);
  const rows = await listRecurring(client);
  assert.equal(client.requests.length, 3);
  assert.ok(
    client.requests.every((r) => r.table === "recurring_transactions"),
    "semua request harus ke tabel recurring_transactions"
  );
  assert.ok(client.maxInflight >= 2, `maxInflight=${client.maxInflight}, harap >= 2`);
  assert.equal(client.requests[0].countExact, true);
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, "t-0");
  assert.equal(rows[2499].id, "t-2499");
});

test("listRecurring: count TIDAK tersedia -> fallback loop BERURUTAN (perilaku lama)", async () => {
  const client = mockPagedClient(4500, { withCount: false });
  const rows = await listRecurring(client);
  assert.equal(client.requests.length, 5);
  assert.equal(client.maxInflight, 1);
  assert.equal(rows.length, 4500);
});

test("listRecurring: error di halaman -> melempar (tidak diam-diam potong data)", async () => {
  const client = mockPagedClient(2500, { failFrom: 1000 });
  await assert.rejects(() => listRecurring(client), /gagal di halaman 1000/);
});
