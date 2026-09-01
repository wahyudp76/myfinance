// Unit test builder config chart (src/ui/charts.js) -- murni, tanpa DOM/Chart.
// Pola: stub deps (formatter/palet/theme) minimal, assert bentuk config + perilaku
// fungsi scriptable/datalabels yang jadi kontrak visual HUD.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTxTrendConfig, buildCashflow7Config, buildAssetDonutConfig, buildMonthlyConfig,
  buildBalanceTrendConfig, buildAssetDetailConfig, buildYearlyNetConfig,
  buildCategoryDonutConfig, buildDailyConfig, buildCatTrendConfig
} from "../../src/ui/charts.js";

const fmtShort = (v) => (v >= 1000 ? Math.round(v / 1000) + "K" : String(v));
const fmtRp = (v) => Number(v).toLocaleString("id-ID");
const grid = () => "#0f172a";
const theme = (k) => ({ income500: "#10b981", income600: "#059669", incomeBar: "#34d399" }[k] || null);
const labelColor = (c) => c;
const noEl = { element: null, chart: null };

test("buildTxTrendConfig: bar net +/- DNA HUD, datalabels cerdas, sumbu teknis, glow", () => {
  const cfg = buildTxTrendConfig({
    chartLabels: ["1", "2", "3"], chartNet: [50000, -20000, 0], labelIndicesToShow: new Set([0, 1]),
    themeAccentColor: theme, formatShortVal: fmtShort, formatRp: fmtRp, chartGridColor: grid
  });
  assert.equal(cfg.type, "bar");
  assert.equal(cfg.plugins[0].id, "hudGlow");
  const ds = cfg.data.datasets[0];
  assert.equal(ds.backgroundColor({ dataIndex: 0, ...noEl }), "#10b981"); // net + -> hijau
  assert.equal(ds.backgroundColor({ dataIndex: 1, ...noEl }), "#f43f5e"); // net - -> merah
  const dl = cfg.options.plugins.datalabels;
  assert.equal(dl.display({ dataset: { data: [50000, -20000, 0] }, dataIndex: 2 }), false); // nilai 0 tanpa label
  assert.equal(dl.display({ dataset: { data: [50000, -20000, 0] }, dataIndex: 0 }), true);
  assert.equal(dl.formatter(-20000), "-20K");
  assert.equal(dl.formatter(50000), "+50K");
  assert.equal(dl.offset({ dataset: { data: [50000] }, dataIndex: 0 }), 2); // positif: offset kecil
  // negatif: offset = tinggi batang px + 4
  const negCtx = { dataset: { data: [-20000] }, dataIndex: 0, chart: { getDatasetMeta: () => ({ data: [{ base: 100, y: 40 }] }) } };
  assert.equal(dl.offset(negCtx), 64);
  assert.equal(cfg.options.plugins.tooltip.callbacks.label({ parsed: { y: -20000 } }), "-Rp 20.000");
  assert.equal(cfg.options.scales.x.ticks.callback(0, 0), "T01·1");
  assert.equal(cfg.options.scales.y.ticks.callback(5000), "Y·5K");
});

test("buildCashflow7Config: 2 dataset (Masuk/Keluar), y disembunyikan, warna datalabel per dataset", () => {
  const cfg = buildCashflow7Config({
    labels7: ["Sen", "Sel"], last7Order: ["Sen", "Sel"], last7Map: { Sen: { in: 100, out: 50 }, Sel: { in: 0, out: 0 } },
    themeAccentColor: theme, formatShortVal: fmtShort, formatRp: fmtRp, chartLabelColor: labelColor
  });
  assert.equal(cfg.type, "bar");
  assert.deepEqual(cfg.data.datasets[0].data, [100, 0]);
  assert.deepEqual(cfg.data.datasets[1].data, [50, 0]);
  assert.equal(cfg.options.scales.y.display, false);
  assert.equal(cfg.options.plugins.datalabels.color({ datasetIndex: 0 }), "#34d399");
  assert.equal(cfg.options.plugins.datalabels.color({ datasetIndex: 1 }), "#fb7185");
  assert.equal(cfg.options.plugins.tooltip.callbacks.label({ dataset: { label: "Masuk" }, raw: 100 }), "Masuk: Rp 100");
});

test("buildAssetDonutConfig: cutout 70 + spacing 6, segmen scriptable (kosong -> emptyColor), glow violet", () => {
  const cfg = buildAssetDonutConfig({ assetLabels: ["BCA", "DANA"], assetData: [60, 40], modernPalette: ["#22d3ee", "#a78bfa"], chartEmptyColor: () => "#f1f5f9" });
  assert.equal(cfg.type, "doughnut");
  assert.equal(cfg.options.cutout, "70%");
  assert.equal(cfg.data.datasets[0].spacing, 6);
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 1, chart: null }), "#a78bfa");
  assert.equal(cfg.plugins[0].id, "hudGlow");
  // state kosong: satu segmen warna empty
  const empty = buildAssetDonutConfig({ assetLabels: ["Kosong"], assetData: [1], modernPalette: ["#22d3ee"], chartEmptyColor: () => "#f1f5f9" });
  assert.equal(empty.data.datasets[0].backgroundColor({ dataIndex: 0, chart: null }), "#f1f5f9");
});

test("buildMonthlyConfig: tanpa bulan -> placeholder 'Bulan Ini' data 0", () => {
  const cfg = buildMonthlyConfig({ monthLabels: [], monthlyMap: {}, themeAccentColor: theme, formatShortVal: fmtShort, chartGridColor: grid, chartLabelColor: labelColor });
  assert.deepEqual(cfg.data.labels, ["Bulan Ini"]);
  assert.deepEqual(cfg.data.datasets[0].data, [0]);
  assert.deepEqual(cfg.data.datasets[1].data, [0]);
  const cfg2 = buildMonthlyConfig({ monthLabels: ["Agu"], monthlyMap: { Agu: { in: 10, out: 4 } }, themeAccentColor: theme, formatShortVal: fmtShort, chartGridColor: grid, chartLabelColor: labelColor });
  assert.deepEqual(cfg2.data.datasets[0].data, [10]);
});

test("buildBalanceTrendConfig: DNA garis acuan (crossRot, tension 0.45, gradasi scriptable + fallback)", () => {
  const cfg = buildBalanceTrendConfig({ trendLabels: ["1 Sep", "2 Sep"], trend: [{ balance: 100 }, { balance: 200 }], lineColor: "#22d3ee", formatRp: fmtRp, formatShortVal: fmtShort, chartGridColor: grid });
  const ds = cfg.data.datasets[0];
  assert.equal(ds.pointStyle, "crossRot");
  assert.equal(ds.tension, 0.45);
  assert.equal(ds.borderWidth, 3);
  assert.equal(ds.borderColor({ chart: { chartArea: null } }), "#22d3ee"); // fallback tanpa chartArea
  assert.equal(ds.backgroundColor({ chart: { chartArea: null } }), "#22d3ee1a");
  assert.equal(cfg.options.scales.x.ticks.callback(0, 1), "T02·2 Sep");
  assert.equal(cfg.options.scales.y.ticks.callback(1500), "Y·2K");
  assert.equal(cfg.plugins[0].id, "hudGlow");
});

test("buildAssetDetailConfig: label tanggal id-ID + DNA garis HUD", () => {
  const cfg = buildAssetDetailConfig({ history: [{ tanggal: "2026-09-01", nilai: 500000 }], lineColor: "#22d3ee", isUp: true, formatRp: fmtRp, formatShortVal: fmtShort, chartGridColor: grid });
  assert.equal(cfg.type, "line");
  assert.equal(cfg.data.labels.length, 1);
  assert.match(cfg.data.labels[0], /1 Sep/);
  assert.equal(cfg.data.datasets[0].pointStyle, "crossRot");
  assert.equal(cfg.options.plugins.tooltip.callbacks.label({ parsed: { y: 5000 } }), "Rp 5.000");
});

test("buildYearlyNetConfig: warna per batang net +/-, maxBarThickness 44", () => {
  const cfg = buildYearlyNetConfig({ monthLabels: ["Agu", "Sep"], monthlyNet: [100, -50], themeAccentColor: theme, formatShortVal: fmtShort, chartGridColor: grid });
  const ds = cfg.data.datasets[0];
  assert.equal(ds.maxBarThickness, 44);
  assert.equal(ds.backgroundColor({ dataIndex: 0, ...noEl }), "#34d399");
  assert.equal(ds.backgroundColor({ dataIndex: 1, ...noEl }), "#fb7185");
  assert.equal(cfg.options.plugins.tooltip.callbacks.label({ parsed: { y: -50 } }), "-Rp50");
});

test("buildCategoryDonutConfig: klik segmen -> openCategoryDetail(label, jenis); 'Kosong' dilewati", () => {
  const opened = [];
  const cfg = buildCategoryDonutConfig({ hasData: true, entries: [{ label: "Makanan", val: 30 }, { label: "Transport", val: 10 }], palette: ["#fb7185", "#fbbf24"], chartEmptyColor: () => "#f1f5f9", openCategoryDetail: (l, j) => opened.push([l, j]), jenis: "Pengeluaran" });
  assert.deepEqual(cfg.data.labels, ["Makanan", "Transport"]);
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 0, chart: null }), "#fb7185");
  cfg.options.onClick({}, [{ index: 0 }], { data: { labels: ["Makanan", "Transport"] } });
  assert.deepEqual(opened, [["Makanan", "Pengeluaran"]]);
  // hover -> cursor pointer
  const style = {};
  cfg.options.onHover({ native: { target: { style } } }, [{}]);
  assert.equal(style.cursor, "pointer");
  // kosong: tidak membuka detail
  const empty = buildCategoryDonutConfig({ hasData: false, entries: [], palette: [], chartEmptyColor: () => "#f1f5f9", openCategoryDetail: (l) => opened.push([l]), jenis: "Pemasukan" });
  assert.deepEqual(empty.data.labels, ["Kosong"]);
  empty.options.onClick({}, [{ index: 0 }], { data: { labels: ["Kosong"] } });
  assert.deepEqual(opened, [["Makanan", "Pengeluaran"]]); // tidak bertambah
});

test("buildDailyConfig: 2 garis solid (gradient false) + area + sumbu teknis", () => {
  const cfg = buildDailyConfig({ dailyLabels: ["1", "2"], dailyMap: { 1: { in: 10, out: 5 }, 2: { in: 0, out: 7 } }, formatShortVal: fmtShort, chartGridColor: grid });
  assert.equal(cfg.type, "line");
  const [inDs, outDs] = cfg.data.datasets;
  assert.equal(inDs.borderColor, "#10b981"); // gradient:false -> warna solid
  assert.equal(outDs.borderColor, "#f43f5e");
  assert.equal(inDs.fill, true);
  assert.equal(inDs.tension, 0.45);
  assert.equal(cfg.options.scales.y.ticks.callback(2000), "Y·2K");
});

test("buildCatTrendConfig: N seri solid per palet + legenda bawah", () => {
  const cfg = buildCatTrendConfig({ labels: ["1", "2"], series: [{ label: "Makanan", data: [1, 2] }, { label: "Transport", data: [3, 4] }], palette: ["#fb7185", "#22d3ee"], formatRp: fmtRp, formatShortVal: fmtShort, chartGridColor: grid });
  assert.equal(cfg.data.datasets.length, 2);
  assert.equal(cfg.data.datasets[0].borderColor, "#fb7185");
  assert.equal(cfg.data.datasets[1].borderColor, "#22d3ee");
  assert.equal(cfg.options.plugins.legend.position, "bottom");
  assert.equal(cfg.options.plugins.tooltip.callbacks.label({ dataset: { label: "Makanan" }, raw: 1500 }), "Makanan: Rp 1.500");
});
