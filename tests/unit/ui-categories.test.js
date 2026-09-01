import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCategoryDetailMonthData, renderCategorySubProportion, formatRupiahShort, buildSubTipHtml } from "../../src/ui/categories.js";

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
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#fb7185"); // Pengeluaran (fallback solid)
  assert.equal(cfg.options.plugins.datalabels.color, "#be123c"); // Pengeluaran
});

test("renderCategoryDetailMonthData: jenis Pemasukan -> hijau (#34d399 / label #047857)", () => {
  const { deps, chartInstances } = makeDeps({ jenis: "Pemasukan" });
  renderCategoryDetailMonthData(deps);
  assert.equal(chartInstances[0].config.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#34d399");
  assert.equal(chartInstances[0].config.options.plugins.datalabels.color, "#047857");
});

test("renderCategoryDetailMonthData: sumbu teknis HUD (grid cyan, tick T/Y) dgn warna chartGridColor + formatter formatShortVal", () => {
  const { deps, chartInstances } = makeDeps();
  renderCategoryDetailMonthData(deps);
  const scales = chartInstances[0].config.options.scales;
  // DNA HUD (chart-hud.hudLineScales): grid x cyan tipis, grid y = yGrid, tick berformat T/Y.
  assert.equal(scales.x.grid.color, "rgba(34,211,238,0.07)");
  assert.equal(scales.y.grid.color, "#f1f5f9");
  assert.equal(scales.y.grid.borderDash, undefined);
  assert.equal(scales.y.ticks.callback(1500), "Y·2K"); // formatShortVal stub (1500/1000=1.5 toFixed(0)='2')
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
  assert.equal(cfg.options.cutout, "70%");
  assert.deepEqual(cfg.data.labels, ["Makanan (langsung)", "Katering"]);
  assert.deepEqual(cfg.data.datasets[0].data, [120000, 60000]);
  // DNA donut HUD: segmen gradasi scriptable (palet colorblind tetap sumber warna).
  assert.equal(typeof cfg.data.datasets[0].backgroundColor, "function");
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#22d3ee");
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 1, element: null, chart: null }), "#f472b6");
  assert.equal(cfg.data.datasets[0].borderWidth, 0);
  assert.ok(cfg.plugins.some((p) => p.id === "hudGlow"));
  assert.ok(doc.host.innerHTML.includes("66,7%"));
  assert.ok(doc.host.innerHTML.includes("33,3%"));
  assert.ok(doc.host.innerHTML.includes("Rp 180000"));
  assert.ok(doc.host.innerHTML.includes("180 rb"));
  assert.ok(doc.host.innerHTML.includes("Rp 120 rb")); // nominal bar kini ringkas
  assert.ok(doc.host.innerHTML.includes("Agustus"));
  assert.ok(doc.host.innerHTML.includes("2x"));
  // datalabels: WAJIB display:false (plugin global; label segmen menabrak teks pusat)
  assert.equal(cfg.options.plugins.datalabels.display, false);
  // tooltip: EKSTERNAL -- internal dimatikan, kartu hitam #000 di bawah donat
  const tt2 = cfg.options.plugins.tooltip;
  assert.equal(typeof tt2.external, "function"); // enabled dibiarkan default (false = tooltip mati total)
  assert.ok(doc.host.innerHTML.includes("cat-sub-tip"));
  assert.ok(doc.host.innerHTML.includes("Ketuk segmen untuk detail"));
});

// ===================== formatRupiahShort (slice polish angka) =====================

test("formatRupiahShort: rb / jt / M / T + desimal koma + buang ,0", () => {
  assert.equal(formatRupiahShort(500), "500");
  assert.equal(formatRupiahShort(900), "900");
  assert.equal(formatRupiahShort(999), "999");
  assert.equal(formatRupiahShort(1000), "1 rb");
  assert.equal(formatRupiahShort(900000), "900 rb");
  assert.equal(formatRupiahShort(1550000), "1,55 jt");
  assert.equal(formatRupiahShort(1250000), "1,25 jt");
  assert.equal(formatRupiahShort(1600000), "1,6 jt");
  assert.equal(formatRupiahShort(12500000), "12,5 jt");
  assert.equal(formatRupiahShort(12000000), "12 jt");
  assert.equal(formatRupiahShort(2000000), "2 jt");
  assert.equal(formatRupiahShort(3400000000), "3,4 M");
  assert.equal(formatRupiahShort(1200000000000), "1,2 T");
  assert.equal(formatRupiahShort(-450000), "-450 rb");
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

test("buildSubTipHtml: kartu hitam MURNI #000 + nama ter-escape + nilai + persen", () => {
  const html = buildSubTipHtml(
    { name: "Katering <Kantor>", total: 450000, pct: 29, count: 2 },
    { formatRp: () => "450.000", fmtPct: (p) => p + "%", color: "#8b5cf6", escapeHtml: (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;") }
  );
  assert.ok(html.includes("background:#000000"));
  assert.ok(html.includes("Katering &lt;Kantor&gt;"));
  assert.ok(html.includes("Rp 450.000"));
  assert.ok(html.includes("29%"));
  assert.ok(html.includes("#8b5cf6"));
});
