import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCategoryDetailMonthData, renderCategorySubProportion } from "../../src/ui/categories.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan fungsi ini (pola yang sama dengan test UI lainnya). Elemen
 * catTrendChart punya getContext('2d') + parentElement.clientWidth (supaya
 * fallback window.innerWidth TIDAK dievaluasi di lingkungan Node).
 */
const makeEl = (id, extra = {}) => ({ id, innerText: "", innerHTML: "", clientWidth: 0, getContext: () => ({ stub: "2d" }), ...extra });

function makeDoc(chartParentWidth = 800) {
  const els = {
    "detail-category-month-label": makeEl("detail-category-month-label"),
    "detail-category-total": makeEl("detail-category-total"),
    "catTrendChart": makeEl("catTrendChart", { parentElement: { clientWidth: chartParentWidth } }),
  };
  return { els, getElementById: (id) => els[id] || null };
}

const formatShortVal = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n));
const parseTgl = (s) => new Date(s + "T00:00:00");
const txIdrAmount = (t) => t.jumlah_idr;

function makeDeps(over = {}) {
  const doc = makeDoc();
  const animateCalls = [];
  const chartInstances = [];
  const destroyed = [];
  const domainCalls = {};
  const deps = {
    document: doc,
    year: 2026, month: 8, jenis: "Pengeluaran",
    specificData: [{ tanggal: "2026-08-05", jumlah_idr: 50000 }],
    computeCategoryDetailMonthChart: (data, y, m, opts) => {
      domainCalls.chart = { data, y, m, opts };
      return { totalMonth: 500000, dailyLabels: ["1", "2", "3"], dailyData: [0, 500000, 0] };
    },
    parseTgl, txIdrAmount,
    animateRupiah: (el, v) => animateCalls.push([el.id, v]),
    isChartNarrow: (w, n) => { domainCalls.narrow = { w, n }; return false; },
    selectSparseLabelIndices: (data, max) => { domainCalls.sparse = { data, max }; return new Set([1]); },
    chartGridColor: () => "#f1f5f9",
    formatShortVal,
    Chart: class { constructor(ctx, config) { this.ctx = ctx; this.config = config; chartInstances.push(this); } },
    charts: {},
    ...over,
  };
  return { deps, doc, animateCalls, chartInstances, destroyed, domainCalls };
}

// ===================== label bulan & total =====================

test("renderCategoryDetailMonthData: label bulan format id-ID panjang (Agustus 2026)", () => {
  const { deps, doc } = makeDeps();
  renderCategoryDetailMonthData(deps);
  assert.equal(doc.els["detail-category-month-label"].innerText, "Agustus 2026");
});

test("renderCategoryDetailMonthData: bulan bergeser -> label ikut (Januari, year rollover dari wrapper)", () => {
  const { deps, doc } = makeDeps({ year: 2027, month: 1 });
  renderCategoryDetailMonthData(deps);
  assert.equal(doc.els["detail-category-month-label"].innerText, "Januari 2027");
});

test("renderCategoryDetailMonthData: total bulan dianimasikan ke #detail-category-total", () => {
  const { deps, animateCalls } = makeDeps();
  renderCategoryDetailMonthData(deps);
  assert.deepEqual(animateCalls, [["detail-category-total", 500000]]);
});

// ===================== penerusan ke domain =====================

test("renderCategoryDetailMonthData: computeCategoryDetailMonthChart menerima specificData by-ref + (year, month, {parseTgl, txIdrAmount})", () => {
  const { deps, domainCalls } = makeDeps();
  renderCategoryDetailMonthData(deps);
  assert.equal(domainCalls.chart.data, deps.specificData);
  assert.equal(domainCalls.chart.y, 2026);
  assert.equal(domainCalls.chart.m, 8);
  assert.equal(domainCalls.chart.opts.parseTgl, parseTgl);
  assert.equal(domainCalls.chart.opts.txIdrAmount, txIdrAmount);
});

test("renderCategoryDetailMonthData: isChartNarrow menerima (lebar container chart, jumlah batang)", () => {
  const { deps, domainCalls } = makeDeps();
  renderCategoryDetailMonthData(deps);
  assert.equal(domainCalls.narrow.w, 800); // clientWidth parent, BUKAN window.innerWidth
  assert.equal(domainCalls.narrow.n, 3);
});

// ===================== chart sempit vs lebar (sparse label) =====================

test("renderCategoryDetailMonthData: chart LEBAR -> selectSparseLabelIndices TIDAK dipanggil", () => {
  const { deps, domainCalls } = makeDeps();
  renderCategoryDetailMonthData(deps);
  assert.equal(domainCalls.sparse, undefined);
});

test("renderCategoryDetailMonthData: chart SEMPIT -> selectSparseLabelIndices(data, 5) dipanggil & display filter menghormati set indeks", () => {
  const { deps, domainCalls, chartInstances } = makeDeps({ isChartNarrow: () => true });
  renderCategoryDetailMonthData(deps);
  assert.deepEqual(domainCalls.sparse.data, [0, 500000, 0]);
  assert.equal(domainCalls.sparse.max, 5);
  const display = chartInstances[0].config.options.plugins.datalabels.display;
  assert.equal(display({ dataset: { data: [0, 500000, 0] }, dataIndex: 1 }), true);  // di set + nilai > 0
  assert.equal(display({ dataset: { data: [0, 500000, 0] }, dataIndex: 0 }), false); // nilai 0 -> tanpa label
  assert.equal(display({ dataset: { data: [0, 500000, 0] }, dataIndex: 2 }), false); // di luar set (nilai 0 juga)
});

// ===================== konfigurasi chart =====================

test("renderCategoryDetailMonthData: chart lama di-destroy dulu; baru bar dgn label/data domain & warna per jenis", () => {
  const { deps, chartInstances, destroyed } = makeDeps();
  deps.charts.catTrend = { destroy: () => destroyed.push(true), _old: true };
  renderCategoryDetailMonthData(deps);
  assert.equal(destroyed.length, 1);
  assert.equal(chartInstances.length, 1);
  assert.equal(deps.charts.catTrend, chartInstances[0]);
  const cfg = chartInstances[0].config;
  assert.equal(cfg.type, "bar");
  assert.deepEqual(cfg.data.labels, ["1", "2", "3"]);
  assert.deepEqual(cfg.data.datasets[0].data, [0, 500000, 0]);
  assert.equal(cfg.data.datasets[0].backgroundColor, "#fb7185"); // Pengeluaran
  assert.equal(cfg.options.plugins.datalabels.color, "#be123c"); // Pengeluaran
});

test("renderCategoryDetailMonthData: jenis Pemasukan -> hijau (#34d399 / label #047857)", () => {
  const { deps, chartInstances } = makeDeps({ jenis: "Pemasukan" });
  renderCategoryDetailMonthData(deps);
  assert.equal(chartInstances[0].config.data.datasets[0].backgroundColor, "#34d399");
  assert.equal(chartInstances[0].config.options.plugins.datalabels.color, "#047857");
});

test("renderCategoryDetailMonthData: grid y putus-putus dgn warna chartGridColor, grid x disembunyikan, formatter formatShortVal", () => {
  const { deps, chartInstances } = makeDeps();
  renderCategoryDetailMonthData(deps);
  const scales = chartInstances[0].config.options.scales;
  assert.equal(scales.x.grid.display, false);
  assert.equal(scales.y.grid.color, "#f1f5f9");
  assert.deepEqual(scales.y.grid.borderDash, [4, 4]);
  assert.equal(scales.y.ticks.callback(1500), "2K"); // formatShortVal stub (1500 -> 2K? tidak: 1500/1000=1.5 toFixed(0)='2')
  assert.equal(chartInstances[0].config.options.plugins.datalabels.formatter(500000), "500K");
});

// ===================== renderCategorySubProportion (slice proporsi sub) =====================

const parseTglS2 = (s) => new Date(s + "T00:00:00");

function makeSubDoc() {
  const fills = [
    { style: {}, dataset: { w: "66.7" } },
    { style: {}, dataset: { w: "33.3" } },
  ];
  const host = { id: "cat-sub-proportion", innerHTML: "", querySelectorAll: () => fills };
  const canvas = { id: "catSubDonut", getContext: () => ({ stub: "2d" }) };
  const els = { "cat-sub-proportion": host, catSubDonut: canvas };
  return { els, host, canvas, fills, getElementById: (id) => els[id] || null };
}

function makeSubDeps(over = {}) {
  const doc = makeSubDoc();
  const chartInstances = [];
  const deps = {
    document: doc,
    year: 2026, month: 8, jenis: "Pengeluaran",
    categoryName: "Makanan",
    specificData: [],
    aggregateSubCategoryShares: () => ({
      totalMonth: 180000,
      items: [
        { name: "Makanan", total: 120000, count: 2, pct: 66.7 },
        { name: "Katering", total: 60000, count: 1, pct: 33.3 },
      ],
    }),
    parseTgl: parseTglS2, txIdrAmount: (t) => t.jumlah_idr,
    formatRp: (n) => String(n),
    escapeHtml: (s) => String(s),
    chartBorderColor: () => "#ffffff",
    Chart: class { constructor(ctx, config) { this.ctx = ctx; this.config = config; chartInstances.push(this); } destroy() {} },
    charts: {},
    requestAnimationFrame: (cb) => cb(),
    ...over,
  };
  return { deps, doc, chartInstances };
}

test("renderCategorySubProportion: donut + label (langsung) + angka % format id", () => {
  const { deps, doc, chartInstances } = makeSubDeps();
  renderCategorySubProportion(deps);
  assert.equal(chartInstances.length, 1);
  const cfg = chartInstances[0].config;
  assert.equal(cfg.type, "doughnut");
  assert.equal(cfg.options.cutout, "72%");
  assert.deepEqual(cfg.data.labels, ["Makanan (langsung)", "Katering"]);
  assert.deepEqual(cfg.data.datasets[0].data, [120000, 60000]);
  assert.deepEqual(cfg.data.datasets[0].backgroundColor, ["#6366f1", "#8b5cf6"]);
  assert.ok(doc.host.innerHTML.includes("66,7%"));
  assert.ok(doc.host.innerHTML.includes("33,3%"));
  assert.ok(doc.host.innerHTML.includes("Rp 180000"));
  assert.ok(doc.host.innerHTML.includes("Agustus"));
  assert.ok(doc.host.innerHTML.includes("2x"));
});

test("renderCategorySubProportion: bar teranimasi 0 -> target lewat rAF ganda", () => {
  const { deps, doc } = makeSubDeps();
  let depth = 0;
  const depsRaf = { ...deps, requestAnimationFrame: (cb) => { depth++; cb(); } };
  renderCategorySubProportion(depsRaf);
  assert.equal(depth, 2);
  assert.equal(doc.fills[0].style.width, "66.7%");
  assert.equal(doc.fills[1].style.width, "33.3%");
});

test("renderCategorySubProportion: <2 slice -> empty-state + chart lama di-destroy", () => {
  let destroyedFlag = false;
  const { deps, doc, chartInstances } = makeSubDeps({
    aggregateSubCategoryShares: () => ({ totalMonth: 50000, items: [{ name: "Satu-satunya", total: 50000, count: 1, pct: 100 }] }),
  });
  deps.charts.catSubDonut = { destroy() { destroyedFlag = true; } };
  renderCategorySubProportion(deps);
  assert.equal(chartInstances.length, 0);
  assert.ok(destroyedFlag);
  assert.ok(doc.host.innerHTML.includes("Belum ada perbandingan proporsi"));
  assert.ok(doc.host.innerHTML.includes("Agustus"));
});

test("renderCategorySubProportion: host hilang -> no-op aman", () => {
  const { deps } = makeSubDeps({ document: { getElementById: () => null } });
  renderCategorySubProportion(deps);
});
