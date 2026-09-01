import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAccountDetailCharts } from "../../src/ui/accounts.js";

/**
 * Stub `document` minimal (pola test UI lainnya). Canvas punya getContext
 * + parentElement.clientWidth supaya fallback window.innerWidth TIDAK
 * dievaluasi di Node.
 */
const makeEl = (id, extra = {}) => ({ id, value: "", clientWidth: 0, getContext: () => ({ stub: "2d" }), parentElement: { clientWidth: 640 }, ...extra });

function makeDoc(over = {}) {
  const els = {
    accountDetailPeriod: makeEl("accountDetailPeriod", { value: "90" }),
    accountBalanceChart: makeEl("accountBalanceChart"),
    accountDetailChart: makeEl("accountDetailChart"),
    accountCatChart: makeEl("accountCatChart"),
    accountCatFilterType: makeEl("accountCatFilterType", { value: "sync" }),
    accountCatFilterMonth: makeEl("accountCatFilterMonth", { value: "2026-08" }),
    "accountCatChart-legend": makeEl("accountCatChart-legend"),
    "accountCatChart-list": makeEl("accountCatChart-list"),
    "accountCatChart-total": makeEl("accountCatChart-total"),
    ...over,
  };
  return { els, getElementById: (id) => els[id] || null };
}

const formatRp = (n) => new Intl.NumberFormat("id-ID").format(n);
const formatShortVal = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n));
const jsStr = (s) => String(s).replace(/'/g, "\\'");
const parseTgl = (s) => new Date(s + "T00:00:00");
const transferTargetAmount = (row) => row.transfer_jumlah_tujuan || row.jumlah;
const chartLabelColorMap = { "#34d399": "#047857", "#fb7185": "#be123c" };

const PALETTE = ["#F472B6", "#A78BFA", "#60A5FA"];

function makeDeps(over = {}) {
  const doc = makeDoc();
  const chartInstances = [];
  const destroyed = [];
  const donutCalls = [];
  const domain = {};
  class StubChart { constructor(ctx, config) { this.config = config; chartInstances.push(this); } destroy() { destroyed.push(this._name || "anon"); } }
  const deps = {
    document: doc,
    currentAccountDetail: "Bank BCA",
    globalData: [{ fake: "tx" }],
    transferTargetAmount, parseTgl,
    buildAccountBalanceSeries: (data, acc, opts) => { domain.series = { data, acc, opts }; return [{ saldo: 1 }]; },
    computeAccountChartSeries: (series, periodVal, opts) => {
      domain.chartSeries = { series, periodVal, opts };
      return { cutoff: new Date(2026, 5, 1), bucketLabels: ["Jun", "Jul", "Ags"], cashInData: [100000, 0, 250000], cashOutData: [50000, 0, 0], balanceLabels: ["a", "b", "c"], balanceChartData: [1, 2, 3] };
    },
    isChartNarrow: (w, n) => { domain.narrow = { w, n }; return false; },
    selectSparseLabelIndices: (mags, max) => { domain.sparse = { mags, max }; return new Set([0]); },
    resolveAccountCategoryDateRange: (type, opts) => { domain.range = { type, opts }; return { start: new Date(2026, 6, 1), end: new Date(2026, 7, 31) }; },
    aggregateAccountExpenseByCategory: (data, acc, opts) => { domain.cat = { data, acc, opts }; return { entries: [{ label: "Makanan", val: 300000 }, { label: "Transport", val: 120000 }] }; },
    getCategoryStyle: (name, jenis) => ({ icon: "fa-" + name, bg: "bg-x-100", color: "text-x-500", jenis }),
    categoryIconHtml: (s) => `<i class="${s.icon}"></i>`,
    jsStr, formatRp, formatShortVal,
    chartGridColor: () => "#f1f5f9",
    chartLabelColor: (bg) => chartLabelColorMap[bg] || bg,
    chartEmptyColor: () => "#f1f5f9",
    chartBorderColor: () => "#ffffff",
    cutePaletteOut: PALETTE,
    renderDonutBreakdown: (opts) => donutCalls.push(opts),
    Chart: StubChart,
    charts: {},
    ...over,
  };
  return { deps, doc, chartInstances, destroyed, donutCalls, domain };
}

// ===================== guard & penerusan domain =====================

test("renderAccountDetailCharts: tanpa currentAccountDetail -> no-op total (tanpa panggilan domain/chart/donut)", () => {
  const { deps, chartInstances, donutCalls, domain } = makeDeps({ currentAccountDetail: null });
  renderAccountDetailCharts(deps);
  assert.equal(chartInstances.length, 0);
  assert.equal(donutCalls.length, 0);
  assert.equal(Object.keys(domain).length, 0);
});

test("renderAccountDetailCharts: periodVal dari select; select hilang -> default '180'", () => {
  const a = makeDeps();
  renderAccountDetailCharts(a.deps);
  assert.equal(a.domain.chartSeries.periodVal, "90");

  const b = makeDeps();
  delete b.doc.els.accountDetailPeriod;
  renderAccountDetailCharts(b.deps);
  assert.equal(b.domain.chartSeries.periodVal, "180");
});

test("renderAccountDetailCharts: buildAccountBalanceSeries menerima (globalData by-ref, accName, {transferTargetAmount, parseTgl})", () => {
  const { deps, domain } = makeDeps();
  renderAccountDetailCharts(deps);
  assert.equal(domain.series.data, deps.globalData);
  assert.equal(domain.series.acc, "Bank BCA");
  assert.equal(domain.series.opts.transferTargetAmount, transferTargetAmount);
  assert.equal(domain.series.opts.parseTgl, parseTgl);
});

// ===================== chart saldo (garis) =====================

test("renderAccountDetailCharts: chart Saldo -> line, label/data domain, tooltip 'Saldo: Rp ...', y-ticks formatShortVal; instance lama di-destroy dulu", () => {
  const { deps, chartInstances, destroyed } = makeDeps();
  const oldBalance = new deps.Chart(null, { type: "old" });
  oldBalance._name = "accBalance";
  deps.charts.accBalance = oldBalance;
  renderAccountDetailCharts(deps);
  assert.ok(destroyed.includes("accBalance"));
  const balance = chartInstances.find(c => c.config.type === "line");
  assert.equal(deps.charts.accBalance, balance);
  assert.deepEqual(balance.config.data.labels, ["a", "b", "c"]);
  assert.deepEqual(balance.config.data.datasets[0].data, [1, 2, 3]);
  // DNA HUD (src/domain/chart-hud.js): stroke gradasi scriptable, crosshair, glow.
  assert.equal(typeof balance.config.data.datasets[0].borderColor, "function");
  assert.equal(balance.config.data.datasets[0].pointStyle, "crossRot");
  assert.equal(balance.config.data.datasets[0].tension, 0.45);
  assert.ok(balance.config.plugins.some((p) => p.id === "hudGlow"));
  assert.equal(balance.config.options.plugins.tooltip.callbacks.label({ raw: 1500 }), "Saldo: Rp 1.500");
  assert.equal(balance.config.options.scales.y.ticks.callback(1500), "Y·2K");
});

// ===================== chart arus kas (bar, sparse label) =====================

test("renderAccountDetailCharts: chart Arus Kas -> bar 2 dataset (Masuk hijau/Keluar merah); lebar dari clientWidth parent; LEBAR -> tanpa sparse", () => {
  const { deps, chartInstances, domain } = makeDeps();
  renderAccountDetailCharts(deps);
  assert.equal(domain.narrow.w, 640); // clientWidth parent container, BUKAN window.innerWidth
  assert.equal(domain.narrow.n, 3);
  assert.equal(domain.sparse, undefined);
  const cashflow = chartInstances.find(c => c.config.type === "bar");
  assert.deepEqual(cashflow.config.data.labels, ["Jun", "Jul", "Ags"]);
  // DNA batang HUD: backgroundColor scriptable -- fallback solid = warna sumber lama.
  const dsIn = cashflow.config.data.datasets[0], dsOut = cashflow.config.data.datasets[1];
  assert.deepEqual({ label: dsIn.label, data: dsIn.data, borderRadius: dsIn.borderRadius, barPercentage: dsIn.barPercentage },
    { label: "Masuk", data: [100000, 0, 250000], borderRadius: 4, barPercentage: 0.92 }); // default rapat
  assert.equal(dsIn.backgroundColor({ dataIndex: 0, element: null, chart: null }), "#34d399");
  assert.equal(dsOut.backgroundColor({ dataIndex: 0, element: null, chart: null }), "#fb7185");
  assert.equal(dsOut.borderSkipped, false);
  assert.ok(cashflow.config.plugins.some((p) => p.id === "hudGlow"));
  assert.equal(cashflow.config.options.plugins.tooltip.callbacks.label({ dataset: { label: "Masuk" }, raw: 2500 }), "Masuk: Rp 2.500");
});

test("renderAccountDetailCharts: SEMPIT -> selectSparseLabelIndices(magnitudes gabungan abs(in)+abs(out), 4) & filter display menghormati set + nilai 0", () => {
  const { deps, chartInstances, domain } = makeDeps({ isChartNarrow: () => true });
  renderAccountDetailCharts(deps);
  assert.deepEqual(domain.sparse.mags, [150000, 0, 250000]); // |100000|+|50000|, |0|+|0|, |250000|+|0|
  assert.equal(domain.sparse.max, 4); // lebih ketat dari chart 1-dataset (5)
  const cashflow = chartInstances.find(c => c.config.type === "bar");
  const display = cashflow.config.options.plugins.datalabels.display;
  assert.equal(display({ dataset: { data: [100000, 0, 250000] }, dataIndex: 0 }), true);  // di set + > 0
  assert.equal(display({ dataset: { data: [100000, 0, 250000] }, dataIndex: 1 }), false); // nilai 0
  assert.equal(display({ dataset: { data: [100000, 0, 250000] }, dataIndex: 2 }), false); // >0 tapi di luar set
  const colorFn = cashflow.config.options.plugins.datalabels.color;
  assert.equal(colorFn({ datasetIndex: 0 }), "#047857"); // via chartLabelColor (dataset 0 = Masuk)
});

// ===================== filter kategori & doughnut =====================

test("renderAccountDetailCharts: filter 'sync' -> customMonthStr null & syncCutoff = cutoff dari chart series", () => {
  const { deps, domain } = makeDeps();
  renderAccountDetailCharts(deps);
  assert.equal(domain.range.type, "sync");
  assert.equal(domain.range.opts.customMonthStr, null);
  assert.equal(domain.range.opts.syncCutoff.getTime(), new Date(2026, 5, 1).getTime());
});

test("renderAccountDetailCharts: filter 'custom' -> baca nilai #accountCatFilterMonth", () => {
  const { deps, doc, domain } = makeDeps();
  doc.els.accountCatFilterType.value = "custom";
  renderAccountDetailCharts(deps);
  assert.equal(domain.range.type, "custom");
  assert.equal(domain.range.opts.customMonthStr, "2026-08");
});

test("renderAccountDetailCharts: aggregateAccountExpenseByCategory menerima (globalData, accName, {getCategoryStyle, parseTgl, start, end})", () => {
  const { deps, domain } = makeDeps();
  renderAccountDetailCharts(deps);
  assert.equal(domain.cat.data, deps.globalData);
  assert.equal(domain.cat.acc, "Bank BCA");
  assert.equal(domain.cat.opts.getCategoryStyle, deps.getCategoryStyle);
  assert.equal(domain.cat.opts.parseTgl, parseTgl);
  assert.equal(domain.cat.opts.start.getTime(), new Date(2026, 6, 1).getTime());
  assert.equal(domain.cat.opts.end.getTime(), new Date(2026, 7, 31).getTime());
});

test("renderAccountDetailCharts: doughnut kategori dgn data -> label per entry + cutePaletteOut; kosong -> 'Belum ada pengeluaran' + chartEmptyColor", () => {
  const withData = makeDeps();
  renderAccountDetailCharts(withData.deps);
  const donut = withData.chartInstances.find(c => c.config.type === "doughnut");
  assert.deepEqual(donut.config.data.labels, ["Makanan", "Transport"]);
  assert.deepEqual(donut.config.data.datasets[0].data, [300000, 120000]);
  // DNA donut HUD: segmen gradasi scriptable -- fallback solid = warna palet per indeks.
  assert.equal(typeof donut.config.data.datasets[0].backgroundColor, "function");
  assert.equal(donut.config.data.datasets[0].backgroundColor({ dataIndex: 1, element: null, chart: null }), PALETTE[1]);
  assert.equal(donut.config.data.datasets[0].borderWidth, 0);
  assert.ok(donut.config.plugins.some((p) => p.id === "hudGlow"));
  assert.equal(donut.config.options.cutout, "70%");

  const empty = makeDeps({ aggregateAccountExpenseByCategory: () => ({ entries: [] }) });
  renderAccountDetailCharts(empty.deps);
  const donut2 = empty.chartInstances.find(c => c.config.type === "doughnut");
  assert.deepEqual(donut2.config.data.labels, ["Belum ada pengeluaran"]);
  assert.deepEqual(donut2.config.data.datasets[0].data, [1]);
  assert.equal(donut2.config.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#f1f5f9");
});

// ===================== legenda donut & elemen opsional =====================

test("renderAccountDetailCharts: renderDonutBreakdown menerima elemen legenda, entries dgn ikon getCategoryStyle, palette, onClickItem openCategoryDetail dgn jsStr, emptyMessage", () => {
  const { deps, doc, donutCalls } = makeDeps({ aggregateAccountExpenseByCategory: () => ({ entries: [{ label: "Jus B'uai", val: 75000 }] }) });
  renderAccountDetailCharts(deps);
  const opts = donutCalls[0];
  assert.equal(opts.legendEl, doc.els["accountCatChart-legend"]);
  assert.equal(opts.listEl, doc.els["accountCatChart-list"]);
  assert.equal(opts.totalEl, doc.els["accountCatChart-total"]);
  assert.deepEqual(opts.entries, [{ label: "Jus B'uai", val: 75000, iconHtml: "<i class=\"fa-Jus B'uai\"></i>" }]);
  assert.equal(opts.palette, PALETTE);
  assert.equal(opts.onClickItem("Jus B'uai"), "openCategoryDetail('Jus B\\'uai','Pengeluaran')"); // kutip di-escape jsStr
  assert.equal(opts.emptyMessage, "Belum ada pengeluaran untuk akun ini pada rentang yang dipilih.");
});

test("renderAccountDetailCharts: canvas hilang -> chart terkait dilewati tanpa error, chart lain & donut tetap jalan", () => {
  const { deps, doc, chartInstances, donutCalls } = makeDeps();
  delete doc.els.accountBalanceChart;
  delete doc.els.accountCatChart;
  renderAccountDetailCharts(deps);
  assert.equal(chartInstances.filter(c => c.config.type === "line").length, 0);
  assert.equal(chartInstances.filter(c => c.config.type === "doughnut").length, 0);
  assert.equal(chartInstances.filter(c => c.config.type === "bar").length, 1); // arus kas tetap
  assert.equal(donutCalls.length, 1); // legenda tetap dirender (perilaku asli)
});
