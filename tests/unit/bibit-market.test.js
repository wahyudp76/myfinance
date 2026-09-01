import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decryptBibitPayload,
  parseBibitFund,
  pickBibitFundMatch,
  normalizeFundName,
  buildBibitListUrl,
} from "../../supabase/functions/_shared/bibit.js";
import {
  roundIdr,
  computeMarketValue,
  withSyncedValue,
  describeSyncSource,
  isBibitNavDate,
} from "../../src/domain/market-sync.js";

// ---------- util fixture: enkripsi ala payload API Bibit (IV||ct||key, hex) ----------
function encryptLikeBibit(obj, keyStr = "0123456789abcdef0123456789abcdef") {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(keyStr, "utf8"), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return iv.toString("hex") + ct.toString("hex") + keyStr;
}

// ---------- decryptBibitPayload ----------
test("decryptBibitPayload: round-trip payload ala Bibit (AES-256-CBC, key di ekor)", async () => {
  const funds = [{ id: 4196, name: "Trimegah Terproteksi Prima 33", nav: { date: "2026-08-29", value: 1000.1033 } }];
  const hex = encryptLikeBibit(funds);
  const out = await decryptBibitPayload(hex);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 4196);
  assert.equal(out[0].nav.value, 1000.1033);
});

test("decryptBibitPayload: payload pendek / hex ganjil ditolak", async () => {
  await assert.rejects(() => decryptBibitPayload("abc"));
  await assert.rejects(() => decryptBibitPayload("a".repeat(200))); // hex ganjil di tengah
});

// ---------- parseBibitFund ----------
test("parseBibitFund: item valid -> field inti; nav tidak valid -> null", () => {
  const ok = parseBibitFund({ id: 7, symbol: "SUCO", name: "  Sucorinvest Stable Fund ", investment_manager: "Syailendra", nav: { date: "2026-08-29", value: 2123.45 } });
  assert.deepEqual(ok, { id: "7", symbol: "SUCO", name: "Sucorinvest Stable Fund", manager: "Syailendra", navValue: 2123.45, navDate: "2026-08-29" });
  assert.equal(parseBibitFund({ id: 1, name: "X", nav: { value: -5 } }), null);
  assert.equal(parseBibitFund({ id: 1, name: "X", nav: null }), null);
  assert.equal(parseBibitFund(null), null);
});

// ---------- pickBibitFundMatch ----------
const ITEMS = [
  { id: 101, name: "Sucorinvest Stable Fund", nav: { value: 2000 } },
  { id: 102, name: " Bahana MES Budi Utama ", nav: { value: 1500 } },
];

test("pickBibitFundMatch: id numerik, nama persis, dan nama ternormalisasi", () => {
  assert.equal(pickBibitFundMatch(ITEMS, "102").id, "102");
  assert.equal(pickBibitFundMatch(ITEMS, "Sucorinvest Stable Fund").id, "101");
  assert.equal(pickBibitFundMatch(ITEMS, "bahana   mes budi utama").id, "102");
  assert.equal(pickBibitFundMatch(ITEMS, "Tidak Ada Dana Ini"), null);
  assert.equal(pickBibitFundMatch(ITEMS, ""), null);
  assert.equal(normalizeFundName("  A   B "), "a b");
});

// ---------- buildBibitListUrl ----------
test("buildBibitListUrl: parameter pencarian & paging terisi", () => {
  const u = new URL(buildBibitListUrl("sucorinvest", 5));
  assert.equal(u.hostname, "api.bibit.id");
  assert.equal(u.searchParams.get("name"), "sucorinvest");
  assert.equal(u.searchParams.get("limit"), "5");
  assert.equal(u.searchParams.get("sort_by"), "7");
  const u2 = new URL(buildBibitListUrl(null));
  assert.equal(u2.searchParams.get("name"), null);
});

// ---------- market-sync: computeMarketValue / roundIdr ----------
test("computeMarketValue: NAB x unit dibulatkan; input tidak valid -> null", () => {
  assert.equal(computeMarketValue(2123.45, 10), 21235); // 21234.5 -> round 21235
  assert.equal(computeMarketValue(1500, 100), 150000);
  assert.equal(computeMarketValue(0, 100), null);
  assert.equal(computeMarketValue(-5, 100), null);
  assert.equal(computeMarketValue(1500, 0), null);
  assert.equal(computeMarketValue("abc", 3), null);
  assert.equal(roundIdr(1234.4), 1234);
  assert.equal(roundIdr("x"), null);
});

// ---------- market-sync: withSyncedValue (aturan history sama dgn submitAsset) ----------
test("withSyncedValue: titik baru ditambahkan; hari sama menimpa", () => {
  const a = { nilai: 100000, value_history: [{ tanggal: "2026-08-01", nilai: 100000 }] };
  const p1 = withSyncedValue(a, { nilaiBaru: 150000, today: "2026-09-01", nowIso: "2026-09-01T03:00:00.000Z" });
  assert.equal(p1.nilai, 150000);
  assert.equal(p1.terakhir, "2026-09-01T03:00:00.000Z");
  assert.deepEqual(p1.value_history, [
    { tanggal: "2026-08-01", nilai: 100000 },
    { tanggal: "2026-09-01", nilai: 150000 },
  ]);
  const p2 = withSyncedValue({ ...a, value_history: p1.value_history }, { nilaiBaru: 160000, today: "2026-09-01", nowIso: "2026-09-01T09:00:00.000Z" });
  assert.equal(p2.value_history.length, 2); // menimpa titik 2026-09-01, bukan menumpuk
  assert.equal(p2.value_history[1].nilai, 160000);
});

test("withSyncedValue: nilai sama -> history tak berubah tapi terakhir diperbarui; input buruk -> throw", () => {
  const a = { nilai: 150000, value_history: [{ tanggal: "2026-09-01", nilai: 150000 }] };
  const p = withSyncedValue(a, { nilaiBaru: 150000, today: "2026-09-01", nowIso: "T" });
  assert.deepEqual(p.value_history, a.value_history);
  assert.equal(p.terakhir, "T");
  assert.throws(() => withSyncedValue(a, { nilaiBaru: 0, today: "2026-09-01" }));
  assert.throws(() => withSyncedValue(a, { nilaiBaru: 5, today: "01-09-2026" }));
});

test("describeSyncSource: label sumber dikenal & fallback", () => {
  assert.match(describeSyncSource("reksadana_bibit"), /Bibit/);
  assert.match(describeSyncSource("manual_nav"), /manual/);
  assert.equal(describeSyncSource("entah"), "entah");
});

test("pickBibitFundMatch: prefix & semua-token hanya bila kandidat tunggal", () => {
  const items = [
    { id: 1, name: "Eastspring Syariah Fixed Income Amanah", nav: { value: 1000 } },
    { id: 2, name: "Eastspring Syariah Equity Islamic", nav: { value: 1000 } },
    { id: 3, name: "Bahana Dana Ekuitas", nav: { value: 1000 } },
    { id: 4, name: "Bahana Dana Tetap", nav: { value: 1000 } },
  ];
  // prefix tunggal
  assert.equal(pickBibitFundMatch(items, "Eastspring Syariah Fixed Income").id, "1");
  // semua token tunggal: "bahana dana" -> 2 kandidat -> null (jangan menebak)
  assert.equal(pickBibitFundMatch(items, "Bahana Dana"), null);
  // semua token tunggal: "bahana ekuitas" -> 1 kandidat
  assert.equal(pickBibitFundMatch(items, "bahana ekuitas").id, "3");
});

test("isBibitNavDate: valid kini, tolak format salah/masa depan/basi", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(isBibitNavDate("2026-09-01", now), true);
  assert.equal(isBibitNavDate("2026-08-15", now), true);
  assert.equal(isBibitNavDate("2026-09-03", now), false);
  assert.equal(isBibitNavDate("2026-07-01", now), false);
  assert.equal(isBibitNavDate("01-09-2026", now), false);
  assert.equal(isBibitNavDate("2026-02-30", now), false);
  assert.equal(isBibitNavDate(null, now), false);
  assert.equal(isBibitNavDate(20260901, now), false);
});
