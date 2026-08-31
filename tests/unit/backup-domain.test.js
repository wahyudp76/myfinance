// Unit tests src/domain/backup.js — logika murni ekspor/impor backup
// (dipindah dari blok BACKUP & RESTORE index.html; orkestrasi DOM tetap
// inline dan tidak diuji di sini).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_APP_TAG, BACKUP_VERSION,
  buildBackupPayload, validateBackupFile, summarizeBackupCounts, mapRestoreRows,
} from "../../src/domain/backup.js";

test("buildBackupPayload: bentuk payload persis versi lama", () => {
  const now = new Date("2026-08-31T10:00:00.000Z");
  const settings = { accounts: [] }, tx = [{ id: 1 }], assets = [], recurring = null;
  const p = buildBackupPayload({ settings, transactions: tx, assets, recurring, now });
  assert.equal(p.app, "MyFinance");
  assert.equal(p.backup_version, 1);
  assert.equal(p.exported_at, "2026-08-31T10:00:00.000Z");
  // pas-by-ref: payload memuat objek yang sama (bukan salinan) seperti kode lama
  assert.equal(p.settings, settings);
  assert.equal(p.transactions, tx);
  assert.equal(p.assets, assets);
  assert.equal(p.recurring, recurring);
});

test("buildBackupPayload: tanpa `now` pakai waktu panggilan (ISO string)", () => {
  const before = new Date().toISOString();
  const p = buildBackupPayload({ settings: {}, transactions: [], assets: [], recurring: [] });
  const after = new Date().toISOString();
  assert.ok(p.exported_at >= before && p.exported_at <= after);
});

test("validateBackupFile: null / app salah / tanpa settings -> tidak valid", () => {
  assert.equal(validateBackupFile(null).ok, false);
  assert.equal(validateBackupFile(undefined).ok, false);
  assert.equal(validateBackupFile({ app: "Other", settings: {} }).ok, false);
  assert.equal(validateBackupFile({ app: "MyFinance" }).ok, false);
  assert.equal(validateBackupFile({ app: "MyFinance", settings: null }).ok, false);
  assert.equal(validateBackupFile({}).ok, false);
});

test("validateBackupFile: payload valid -> ok + objek yang sama dikembalikan", () => {
  const backup = { app: "MyFinance", backup_version: 1, settings: { a: 1 }, transactions: [] };
  const v = validateBackupFile(backup);
  assert.equal(v.ok, true);
  assert.equal(v.backup, backup);
});

test("summarizeBackupCounts: array hilang dihitung 0, jumlah akurat", () => {
  assert.deepEqual(summarizeBackupCounts({}), { txCount: 0, assetCount: 0, recurCount: 0 });
  assert.deepEqual(summarizeBackupCounts({ transactions: null, assets: undefined }), { txCount: 0, assetCount: 0, recurCount: 0 });
  assert.deepEqual(
    summarizeBackupCounts({ transactions: [1, 2, 3], assets: [1], recurring: [1, 2] }),
    { txCount: 3, assetCount: 1, recurCount: 2 }
  );
});

test("mapRestoreRows: buang id & user_id lama, user_id baru di akhir", () => {
  const rows = mapRestoreRows(
    [{ id: "old-id", user_id: "lama", tanggal: "2026-01-01", jumlah: 1000, keterangan: "x" }],
    "akun-baru"
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { tanggal: "2026-01-01", jumlah: 1000, keterangan: "x", user_id: "akun-baru" });
  // user_id harus key TERAKHIR (urutan spread versi lama)
  assert.deepEqual(Object.keys(rows[0]).at(-1), "user_id");
  assert.ok(!("id" in rows[0]));
});

test("mapRestoreRows: list kosong/null -> array kosong, field lain utuh", () => {
  assert.deepEqual(mapRestoreRows([], "u"), []);
  assert.deepEqual(mapRestoreRows(null, "u"), []);
  assert.deepEqual(mapRestoreRows(undefined, "u"), []);
  const [row] = mapRestoreRows([{ id: 1, user_id: "a", nested: { k: "v" } }], "u");
  assert.deepEqual(row.nested, { k: "v" });
});
