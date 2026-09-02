// Tier-2 struktural #5: Chart.js & DataLabels LAZY (loader paralel, bukan
// classic script blocking) + gerbang di loadData sebelum render grafik.
// v54: app (termasuk loadData) hidup di app.js (diekstrak dari index.html) --
// pola app dicari di app.js, pola loader chart TETAP di index.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const appJs = readFileSync(resolve(ROOT, "app.js"), "utf8");

test("chart libs: TIDAK ada lagi <script src> langsung utk chart.js/datalabels", () => {
  assert.ok(!html.includes('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'));
  assert.ok(!html.includes('<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0"></script>'));
});

test("chart libs: loader paralel __mfChartLibReady ada, urutan chart.js -> datalabels", () => {
  assert.ok(html.includes("window.__mfChartLibReady = new Promise"));
  const iChart = html.indexOf("npm/chart.js'");
  const iDl = html.indexOf("chartjs-plugin-datalabels@2.0.0'");
  assert.ok(iChart > 0 && iDl > 0 && iChart < iDl, "chart.js dimuat lebih dulu");
});

test("loadData: async + meng-gerbangi __mfChartLibReady sebelum render (di app.js)", () => {
  assert.ok(/async function loadData/.test(appJs), "loadData harus ada di app.js");
  const iLoad = appJs.indexOf("async function loadData()");
  const iGate = appJs.indexOf("await window.__mfChartLibReady", iLoad);
  assert.ok(iLoad > 0 && iGate > iLoad, "gerbang ada di dalam loadData");
});
