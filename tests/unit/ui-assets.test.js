import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAssetView } from "../../src/ui/assets.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan renderAssetView (pola yang sama dengan test UI lainnya).
 * Elemen palsu objek biasa: innerHTML/innerText/textContent/className/
 * style settable, classList mencatat add/remove/toggle, canvas punya
 * getContext('2d'). Tidak butuh jsdom/Playwright.
 */
function makeClassList() {
  const classes = new Set();
  return {
    add: (...cs) => cs.forEach(c => classes.add(c)),
    remove: (...cs) => cs.forEach(c => classes.delete(c)),
    toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; on ? classes.add(c) : classes.delete(c); return on; },
    contains: c => classes.has(c),
    _set: classes,
  };
}

const makeEl = (id, extra = {}) => ({ id, innerHTML: "", innerText: "", textContent: "", className: "", style: {}, classList: makeClassList(), ...extra });

const ALL_IDS = [
  "networth-total", "networth-aset", "networth-utang", "networth-bar-aset", "networth-bar-utang",
  "asset-list-container", "asset-count", "asset-total-value", "asset-total-modal",
  "asset-total-return", "asset-return-badge", "asset-performer-row",
  "asset-best-name", "asset-best-pct", "asset-worst-name", "asset-worst-pct",
  "assetAllocationChart", "assetAllocationChart-legend", "assetAllocationChart-list", "assetAllocationChart-total",
];

function makeDoc() {
  const els = {};
  for (const id of ALL_IDS) els[id] = makeEl(id);
  els["assetAllocationChart"] = makeEl("assetAllocationChart", { getContext: () => ({ stub: "2d" }) });
  return { els, getElementById: (id) => els[id] || null };
}

const formatRp = (n) => new Intl.NumberFormat("id-ID").format(n);
const escapeHtml = (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jsStr = (s) => String(s).replace(/'/g, "\\'");

const baseSummary = {
  sortedAssets: [
    { id: "a1", nama: "Emas", kategori: "Emas", platform: "Antam", modal: 25000000, nilai: 27800000, isUp: true, returnRp: 2800000, returnPct: 11.2, terakhir: "2026-08-25T00:00:00Z" },
    { id: "a2", nama: "Sea<b>bank</b>", kategori: "Deposito", platform: "Seabank", modal: 16000000, nilai: 15500000, isUp: false, returnRp: -500000, returnPct: -3.125, terakhir: null },
  ],
  totalNilai: 43300000, totalModal: 41000000,
  catMap: { Emas: 27800000, Deposito: 15500000 },
  totalReturn: 2300000, totalReturnPct: 5.61,
  best: { nama: "Emas", pct: 11.2 }, worst: { nama: "Seabank", pct: -3.125 },
};

function makeDeps(over = {}) {
  const doc = makeDoc();
  const animateCalls = [];
  const chartInstances = [];
  const donutCalls = [];
  const deps = {
    document: doc,
    globalAssets: [{ id: "a1" }, { id: "a2" }],
    appSettings: { debts: [{ id: "d1", sisa: 2000000 }] },
    summarizeAssets: () => JSON.parse(JSON.stringify(baseSummary)),
    computeNetWorth: (totalNilai) => ({ totalUtangBersih: 2000000, netWorth: totalNilai - 2000000 }),
    animateRupiah: (el, v) => animateCalls.push([el.id, v]),
    escapeHtml, formatRp, jsStr,
    getAccountLogo: (p) => `<i class="fas fa-institution" data-p="${p}"></i>`,
    detectAssetCategoryIcon: (k) => `fa-${String(k).toLowerCase()}-icon`,
    renderDonutBreakdown: (opts) => donutCalls.push(opts),
    chartEmptyColor: () => "#f1f5f9",
    chartBorderColor: () => "#ffffff",
    Chart: class { constructor(ctx, config) { this.ctx = ctx; this.config = config; chartInstances.push(this); } },
    charts: {},
    ...over,
  };
  return { deps, animateCalls, chartInstances, donutCalls, doc };
}

// ===================== Kekayaan Bersih (di-render PALING AWAL) =====================

test("renderAssetView: widget Kekayaan Bersih di-render paling awal (urutan animateRupiah: total, aset, utang)", () => {
  const { deps, animateCalls } = makeDeps();
  renderAssetView(deps);
  assert.equal(animateCalls[0][0], "networth-total");
  assert.equal(animateCalls[0][1], 43300000 - 2000000);
  assert.equal(animateCalls[1][0], "networth-aset");
  assert.equal(animateCalls[1][1], 43300000);
  assert.equal(animateCalls[2][0], "networth-utang");
  assert.equal(animateCalls[2][1], 2000000);
});

test("renderAssetView: netWorth negatif -> toggle text-rose-300 ON; positif -> OFF", () => {
  const neg = makeDeps({ computeNetWorth: () => ({ totalUtangBersih: 90000000, netWorth: -1 }) });
  renderAssetView(neg.deps);
  assert.equal(neg.doc.els["networth-total"].classList.contains("text-rose-300"), true);

  const pos = makeDeps();
  renderAssetView(pos.deps);
  assert.equal(pos.doc.els["networth-total"].classList.contains("text-rose-300"), false);
});

test("renderAssetView: bar proporsi aset vs utang sesuai rumus nwDenom (dan 100% saat denom 0)", () => {
  const { deps, doc } = makeDeps();
  renderAssetView(deps);
  const expected = (43300000 / (43300000 + 2000000)) * 100;
  assert.equal(doc.els["networth-bar-aset"].style.width, expected + "%");
  assert.equal(doc.els["networth-bar-utang"].style.width, (100 - expected) + "%");

  const zero = makeDeps({ computeNetWorth: () => ({ totalUtangBersih: 0, netWorth: 0 }) });
  zero.deps.summarizeAssets = () => ({ ...baseSummary, totalNilai: 0, catMap: {} });
  renderAssetView(zero.deps);
  assert.equal(zero.doc.els["networth-bar-aset"].style.width, "100%");
});

// ===================== Daftar aset =====================

test("renderAssetView: belum ada aset -> empty state 'Belum ada aset' + count 0", () => {
  const { deps, doc } = makeDeps({ globalAssets: [], summarizeAssets: () => ({ ...baseSummary, sortedAssets: [], totalNilai: 0, totalModal: 0, catMap: {}, totalReturn: 0, totalReturnPct: 0, best: null, worst: null }) });
  renderAssetView(deps);
  const html = doc.els["asset-list-container"].innerHTML;
  assert.match(html, /Belum ada aset/);
  assert.match(html, /Tambah Aset/);
  assert.equal(doc.els["asset-count"].innerText, 0);
});

test("renderAssetView: kartu aset -> nama/platform di-escape, logo platform, onclick detail dgn jsStr, tombol edit/hapus stopPropagation", () => {
  const { deps, doc } = makeDeps();
  renderAssetView(deps);
  const html = doc.els["asset-list-container"].innerHTML;
  assert.match(html, /onclick="openAssetDetailModal\('a1'\)"/);
  assert.match(html, /onclick="openAssetDetailModal\('a2'\)"/);
  assert.match(html, /onclick="event\.stopPropagation\(\); openAssetModal\(true, 'a1'\)"/);
  assert.match(html, /onclick="event\.stopPropagation\(\); deleteAssetData\('a2'\)"/);
  assert.match(html, /data-p="Antam"/); // getAccountLogo(a.platform)
  assert.match(html, /Sea&lt;b&gt;bank&lt;\/b&gt;/); // escapeHtml nama
  assert.match(html, />Emas<\/span>/); // kategori badge (v70: kini di-escape; teks polos tetap verbatim)
});

test("renderAssetView: kartu aset -> modal & nilai formatRp, return hijau utk naik / merah utk turun dgn nilai absolut", () => {
  const { deps, doc } = makeDeps();
  renderAssetView(deps);
  const html = doc.els["asset-list-container"].innerHTML;
  assert.match(html, /Rp 25\.000\.000/); // modal a1
  assert.match(html, /Rp 27\.800\.000/); // nilai a1
  assert.match(html, /bg-emerald-50 text-emerald-500/);
  assert.match(html, /fa-arrow-trend-up/);
  assert.match(html, /Rp 2\.800\.000 \(11\.2%\)/);
  assert.match(html, /bg-rose-50 text-rose-500/);
  assert.match(html, /fa-arrow-trend-down/);
  assert.match(html, /Rp 500\.000 \(3\.1%\)/); // abs(-500000), abs(-3.125).toFixed(1)
});

// ===================== Ringkasan total & performer =====================

test("renderAssetView: total return positif -> '+Rp 2.300.000' & badge emerald '+5.61%'", () => {
  const { deps, doc } = makeDeps();
  renderAssetView(deps);
  assert.equal(doc.els["asset-total-return"].innerText, "+Rp 2.300.000");
  assert.equal(doc.els["asset-return-badge"].innerText, "+5.61%");
  assert.match(doc.els["asset-return-badge"].className, /bg-emerald-100 text-emerald-600/);
});

test("renderAssetView: total return negatif -> '-Rp ...' & badge rose tanpa '+'", () => {
  const { deps, doc } = makeDeps({ summarizeAssets: () => ({ ...baseSummary, totalReturn: -500000, totalReturnPct: -1.2 }) });
  renderAssetView(deps);
  assert.equal(doc.els["asset-total-return"].innerText, "-Rp 500.000");
  assert.equal(doc.els["asset-return-badge"].innerText, "-1.20%");
  assert.match(doc.els["asset-return-badge"].className, /bg-rose-100 text-rose-600/);
});

test("renderAssetView: best/worst ada -> nama & pct (+ utk positif, tanpa + utk negatif), row tampil grid", () => {
  const { deps, doc } = makeDeps();
  renderAssetView(deps);
  assert.equal(doc.els["asset-best-name"].textContent, "Emas");
  assert.equal(doc.els["asset-best-pct"].textContent, "+11.2%");
  assert.equal(doc.els["asset-worst-name"].textContent, "Seabank");
  assert.equal(doc.els["asset-worst-pct"].textContent, "-3.1%");
  assert.equal(doc.els["asset-performer-row"].classList.contains("hidden"), false);
  assert.equal(doc.els["asset-performer-row"].classList.contains("grid"), true);
});

test("renderAssetView: best/worst null -> performer row disembunyikan", () => {
  const { deps, doc } = makeDeps({ summarizeAssets: () => ({ ...baseSummary, best: null, worst: null }) });
  renderAssetView(deps);
  assert.equal(doc.els["asset-performer-row"].classList.contains("hidden"), true);
  assert.equal(doc.els["asset-performer-row"].classList.contains("grid"), false);
});

// ===================== Chart alokasi & legenda donut =====================

test("renderAssetView: chart lama di-destroy dulu, chart baru doughnut dgn label/data/palette kategori", () => {
  const { deps, chartInstances } = makeDeps();
  const destroyed = [];
  deps.charts.assetAlloc = { destroy: () => destroyed.push(true) };
  renderAssetView(deps);
  assert.equal(destroyed.length, 1);
  assert.equal(chartInstances.length, 1);
  assert.equal(deps.charts.assetAlloc, chartInstances[0]); // holder di-update (objek sama yg di-inject)
  const cfg = chartInstances[0].config;
  assert.equal(cfg.type, "doughnut");
  assert.deepEqual(cfg.data.labels, ["Emas", "Deposito"]);
  assert.deepEqual(cfg.data.datasets[0].data, [27800000, 15500000]);
  // DNA donut HUD: segmen gradasi scriptable (modernPalette tetap sumber warna), glow violet.
  assert.equal(typeof cfg.data.datasets[0].backgroundColor, "function");
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 2, element: null, chart: null }), "#a78bfa"); // modernPalette[2]
  assert.equal(cfg.data.datasets[0].borderWidth, 0);
  assert.ok(cfg.plugins.some((p) => p.id === "hudGlow"));
  assert.equal(cfg.options.cutout, "70%");
});

test("renderAssetView: tanpa kategori -> chart 'Kosong' dgn warna chartEmptyColor", () => {
  const { deps, chartInstances } = makeDeps({ summarizeAssets: () => ({ ...baseSummary, catMap: {} }) });
  renderAssetView(deps);
  const cfg = chartInstances[0].config;
  assert.deepEqual(cfg.data.labels, ["Kosong"]);
  assert.deepEqual(cfg.data.datasets[0].data, [1]);
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#f1f5f9");
});

test("renderAssetView: renderDonutBreakdown menerima elemen legenda/list/total, entries dgn ikon kategori, palette & emptyMessage", () => {
  const { deps, doc, donutCalls } = makeDeps();
  renderAssetView(deps);
  assert.equal(donutCalls.length, 1);
  const opts = donutCalls[0];
  assert.equal(opts.legendEl, doc.els["assetAllocationChart-legend"]);
  assert.equal(opts.listEl, doc.els["assetAllocationChart-list"]);
  assert.equal(opts.totalEl, doc.els["assetAllocationChart-total"]);
  assert.deepEqual(opts.entries.map(e => e.label), ["Emas", "Deposito"]);
  assert.deepEqual(opts.entries.map(e => e.val), [27800000, 15500000]);
  assert.match(opts.entries[0].iconHtml, /fa-emas-icon/);
  assert.equal(opts.palette[0], "#22d3ee");
  assert.equal(opts.emptyMessage, "Belum ada aset yang dicatat.");
});

// ===================== Penerusan dependency =====================

test("renderAssetView: summarizeAssets menerima globalAssets; computeNetWorth menerima (totalNilai, appSettings.debts)", () => {
  const calls = {};
  const { deps } = makeDeps({
    summarizeAssets: (assets) => { calls.assets = assets; return JSON.parse(JSON.stringify(baseSummary)); },
    computeNetWorth: (totalNilai, debts) => { calls.totalNilai = totalNilai; calls.debts = debts; return { totalUtangBersih: 0, netWorth: totalNilai }; },
  });
  renderAssetView(deps);
  assert.equal(calls.assets, deps.globalAssets); // referensi sama, bukan salinan
  assert.equal(calls.totalNilai, baseSummary.totalNilai);
  assert.equal(calls.debts, deps.appSettings.debts);
});
