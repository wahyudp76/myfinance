import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIdxTicker,
  yahooChartUrls,
  pickYahooMarketPrice,
  yahooFailureMessage,
} from "../../supabase/functions/_shared/price-sources.js";

test("normalizeIdxTicker: huruf besar + akhiran .JK idempoten", () => {
  assert.equal(normalizeIdxTicker("bbca"), "BBCA.JK");
  assert.equal(normalizeIdxTicker("TLKM.JK"), "TLKM.JK");
  assert.equal(normalizeIdxTicker("  bri "), "BRI.JK");
  assert.equal(normalizeIdxTicker(""), "");
});

test("yahooChartUrls: dua mirror berurutan, ticker ter-encode", () => {
  const urls = yahooChartUrls("bbca");
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/BBCA\.JK$/);
  assert.match(urls[1], /^https:\/\/query2\.finance\.yahoo\.com\/v8\/finance\/chart\/BBCA\.JK$/);
});

test("pickYahooMarketPrice: payload chart valid -> price+timeIso; rusak -> null", () => {
  const ok = pickYahooMarketPrice({
    chart: { result: [{ meta: { regularMarketPrice: 9325, regularMarketTime: 1788254099 } }], error: null },
  });
  assert.equal(ok.price, 9325);
  assert.match(ok.timeIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(pickYahooMarketPrice({ chart: { result: [] } }), null);
  assert.equal(pickYahooMarketPrice({ chart: { result: [{ meta: { regularMarketPrice: -5 } }] } }), null);
  assert.equal(pickYahooMarketPrice({}), null);
  assert.equal(pickYahooMarketPrice(null), null);
});

test("yahooFailureMessage: menyebut kode + jalur manual", () => {
  const m = yahooFailureMessage("BBCA");
  assert.match(m, /BBCA/);
  assert.match(m, /Manual/);
});
