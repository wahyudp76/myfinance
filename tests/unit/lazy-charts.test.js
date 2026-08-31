// Tier-2 struktural #5: Chart.js & DataLabels LAZY (loader paralel, bukan
// classic script blocking) + gerbang di loadData sebelum render grafik.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

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

test("loadData: async + meng-gerbangi __mfChartLibReady sebelum render", () => {
  assert.ok(/async function loadData\(\)/.test(html));
  const iLoad = html.indexOf("async function loadData()");
  const iGate = html.indexOf("await window.__mfChartLibReady", iLoad);
  assert.ok(iLoad > 0 && iGate > iLoad, "gerbang ada di dalam loadData");
});
