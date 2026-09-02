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
  // v59: library vendored lokal -- asersi CDN jadi dobel: tidak boleh ada tag
  // blocking dari CDN LUPA pun dari vendor (harus tetap lewat loader dinamis).
  assert.ok(!html.includes('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'));
  assert.ok(!html.includes('<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0"></script>'));
  assert.ok(!html.includes('<script src="./vendor/chartjs-4.5.1.min.js"></script>'));
  assert.ok(!html.includes('<script src="./vendor/chartjs-plugin-datalabels-2.0.0.min.js"></script>'));
});

test("chart libs: loader paralel __mfChartLibReady ada, urutan chart.js -> datalabels", () => {
  assert.ok(html.includes("window.__mfChartLibReady = new Promise"));
  const iChart = html.indexOf("./vendor/chartjs-4.5.1.min.js'");
  const iDl = html.indexOf("./vendor/chartjs-plugin-datalabels-2.0.0.min.js'");
  assert.ok(iChart > 0 && iDl > 0 && iChart < iDl, "chart.js dimuat lebih dulu");
});

test("loadData: async + meng-gerbangi __mfChartLibReady sebelum render (di app.js)", () => {
  // v55: app.js adalah OUTPUT BUILD (terser) dari app.src.js -- spasi
  // `function foo ()` dikompaksi jadi `function foo(){`, jadi pencarian nama
  // memakai regex toleran-spasi. Nama fungsi sendiri TIDAK ikut di-mangle
  // (build-app.mjs: mangle.toplevel=false + keep_fnames=true) dan dijaga
  // tests/unit/app-minify.test.js.
  const mLoad = appJs.match(/async function loadData\s*\(/);
  assert.ok(mLoad, "loadData harus ada di app.js");
  const iLoad = mLoad.index;
  const iGate = appJs.indexOf("await window.__mfChartLibReady", iLoad);
  assert.ok(iLoad > 0 && iGate > iLoad, "gerbang ada di dalam loadData");
});
