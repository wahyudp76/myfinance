import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBudgetView, renderBudgetModalList } from "../../src/ui/budgets.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan 2 fungsi ini (pola yang sama dengan test UI lainnya). Elemen
 * palsu objek biasa dgn innerHTML/innerText/className/style settable,
 * classList mencatat add/remove, ring punya setAttribute, canvas punya
 * getContext('2d'). Tidak butuh jsdom/Playwright.
 */
function makeClassList() {
  const classes = new Set(["hidden"]); // overlay & row default-nya hidden di markup asli
  return {
    add: (...cs) => cs.forEach(c => classes.add(c)),
    remove: (...cs) => cs.forEach(c => classes.delete(c)),
    contains: c => classes.has(c),
    _set: classes,
  };
}

const makeEl = (id, extra = {}) => ({ id, innerHTML: "", innerText: "", textContent: "", className: "", value: "", style: {}, classList: makeClassList(), setAttribute: function (k, v) { this["_attr_" + k] = v; }, getContext: () => ({ stub: "2d" }), ...extra });

const VIEW_IDS = [
  "budget-total-plan", "budget-total-actual", "budget-total-remaining",
  "budget-ring-progress", "budget-ring-pct", "budget-status-msg",
  "budgetCompareChart", "budgetCompareEmpty", "budget-category-list",
];

const formatRp = (n) => new Intl.NumberFormat("id-ID").format(n);
const formatShortVal = (n) => (Math.abs(n) >= 1000000 ? (n / 1000000).toFixed(1) + "M" : Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + "K" : n);
const escapeHtml = (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slugify = (s) => String(s).replace(/[^a-zA-Z0-9]/g, "_");
// Stub level pemakaian (level asli sudah dites di budgets-domain.test.js;
 // di sini yang dites adalah pemetaan PRESENTASI per level).
const classifyBudgetUsage = (pct) => (pct >= 100 ? "over" : pct >= 80 ? "warning" : "safe");

function baseEntries() {
  return [
    { name: "Makanan", budget: 100000, actual: 120000, pct: 120, icon: "fa-utensils", bg: "bg-orange-100", color: "text-orange-500",
      subEntries: [{ name: "Makan di luar", budget: 60000, actual: 30000, pct: 50, isDirect: true, icon: "fa-bowl-food", bg: "bg-orange-100", color: "text-orange-500" }] },
    { name: "Hiburan", budget: 200000, actual: 150000, pct: 75, icon: "fa-gamepad", bg: "bg-purple-100", color: "text-purple-500" },
  ];
}

function makeViewDeps(over = {}) {
  const els = {};
  els["budgetFilterMonth"] = makeEl("budgetFilterMonth", { value: "2026-08" });
  for (const id of VIEW_IDS) els[id] = makeEl(id);
  const doc = { els, getElementById: (id) => els[id] || null };

  const animateCalls = [];
  const chartInstances = [];
  const destroyed = [];
  const domainCalls = {};
  const categoryIconCalls = [];

  const deps = {
    document: doc,
    globalData: [{ fake: "tx" }],
    txIdrAmount: (t) => t.jumlah_idr,
    parseTgl: (s) => new Date(s),
    categoryDict: { pengeluaran: { Makanan: {}, Hiburan: {} } },
    cloudBudgets: { Makanan: 100000 },
    getCategoryStyle: (name, jenis) => ({ icon: "fa-" + slugify(name), bg: "bg-slate-100", color: "text-slate-600", forJenis: jenis }),
    animateRupiah: (el, v) => animateCalls.push([el.id, v]),
    escapeHtml, formatRp, formatShortVal,
    categoryIconHtml: (style, wrap) => { categoryIconCalls.push(style); return `<i class="${style.icon}" data-wrap="${wrap}"></i>`; },
    chartLabelColor: (bg) => bg,
    chartGridColor: () => "#f1f5f9",
    Chart: class { constructor(ctx, config) { this.ctx = ctx; this.config = config; chartInstances.push(this); } },
    charts: {},
    aggregateActualByCategory: (data, opts) => { domainCalls.agg = { data, opts }; return { "Makan di luar": 30000 }; },
    summarizeBudgets: (pengeluaran, budgets, actualMap, opts) => {
      domainCalls.sum = { pengeluaran, budgets, actualMap, opts };
      return deps._summary;
    },
    classifyBudgetUsage,
    _summary: { entries: baseEntries(), totalBudget: 300000, totalActual: 270000, remaining: 30000, overallPct: 90 },
    ...over,
  };
  return { deps, doc, els, animateCalls, chartInstances, destroyed, domainCalls, categoryIconCalls };
}

// ===================== renderBudgetView: totals & ring =====================

test("renderBudgetView: monthInput tidak ada -> early return, tidak ada animate", () => {
  const { deps, animateCalls } = makeViewDeps();
  deps.document = { getElementById: () => null };
  renderBudgetView(deps);
  assert.equal(animateCalls.length, 0);
});

test("renderBudgetView: month kosong -> di-auto-isi bulan berjalan (YYYY-MM)", () => {
  const { deps, els } = makeViewDeps();
  els["budgetFilterMonth"].value = "";
  renderBudgetView(deps);
  assert.match(els["budgetFilterMonth"].value, /^\d{4}-\d{2}$/);
});

test("renderBudgetView: totals diteruskan ke animateRupiah; sisa positif -> 'Rp ...' emerald", () => {
  const { deps, els, animateCalls } = makeViewDeps();
  renderBudgetView(deps);
  assert.deepEqual(animateCalls, [["budget-total-plan", 300000], ["budget-total-actual", 270000]]);
  assert.equal(els["budget-total-remaining"].innerText, "Rp 30.000");
  assert.match(els["budget-total-remaining"].className, /text-emerald-400/);
});

test("renderBudgetView: sisa negatif -> '-Rp ...' rose", () => {
  const { deps, els } = makeViewDeps({ _summary: { entries: baseEntries(), totalBudget: 300000, totalActual: 320000, remaining: -20000, overallPct: 106 } });
  renderBudgetView(deps);
  assert.equal(els["budget-total-remaining"].innerText, "-Rp 20.000");
  assert.match(els["budget-total-remaining"].className, /text-rose-400/);
});

test("renderBudgetView: ring -- warna per level, pct asli di teks, offset di-clamp 100", () => {
  const C = 2 * Math.PI * 52;
  const { deps, els } = makeViewDeps({ _summary: { entries: baseEntries(), totalBudget: 100000, totalActual: 120000, remaining: -20000, overallPct: 120 } });
  renderBudgetView(deps);
  const ring = els["budget-ring-progress"];
  assert.equal(ring["_attr_stroke-dasharray"], `${C}`);
  assert.equal(ring["_attr_stroke-dashoffset"], "0"); // 120% di-clamp ke 100 -> offset 0
  assert.equal(ring.style.stroke, "#fb7185"); // over
  assert.equal(els["budget-ring-pct"].innerText, "120%"); // teks tetap pct ASLI

  const half = makeViewDeps({ _summary: { entries: baseEntries(), totalBudget: 200000, totalActual: 100000, remaining: 100000, overallPct: 50 } });
  renderBudgetView(half.deps);
  assert.equal(half.els["budget-ring-progress"]["_attr_stroke-dashoffset"], `${C - (50 / 100) * C}`);
  assert.equal(half.els["budget-ring-progress"].style.stroke, "#34d399"); // safe
});

test("renderBudgetView: pesan status mengikuti level overall ('over' -> Waduh...)", () => {
  const { deps, els } = makeViewDeps({ _summary: { entries: baseEntries(), totalBudget: 100000, totalActual: 120000, remaining: -20000, overallPct: 120 } });
  renderBudgetView(deps);
  assert.match(els["budget-status-msg"].innerText, /Waduh, pengeluaranmu sudah melebihi budget!/);
});

// ===================== renderBudgetView: chart & daftar =====================

test("renderBudgetView: chart lama di-destroy dulu; chart baru bar dgn 2 dataset + warna realisasi per level", () => {
  const { deps, chartInstances } = makeViewDeps();
  deps.charts.budgetCompare = { destroy: () => {}, _old: true };
  const destroyed = [];
  deps.charts.budgetCompare.destroy = () => destroyed.push(true);
  renderBudgetView(deps);
  assert.equal(destroyed.length, 1);
  assert.equal(chartInstances.length, 1);
  assert.equal(deps.charts.budgetCompare, chartInstances[0]);
  const cfg = chartInstances[0].config;
  assert.equal(cfg.type, "bar");
  assert.deepEqual(cfg.data.labels, ["Makanan", "Hiburan"]);
  assert.deepEqual(cfg.data.datasets[0].data, [100000, 200000]); // Budget
  assert.deepEqual(cfg.data.datasets[1].data, [120000, 150000]); // Realisasi
  // DNA batang HUD: scriptable -- fallback solid per batang = warna level (over, safe).
  assert.equal(cfg.data.datasets[1].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#fb7185"); // over
  assert.equal(cfg.data.datasets[1].backgroundColor({ dataIndex: 1, element: null, chart: null }), "#34d399"); // safe
  assert.equal(cfg.data.datasets[0].backgroundColor({ dataIndex: 0, element: null, chart: null }), "#c7d2fe"); // Budget
  assert.ok(cfg.plugins.some((p) => p.id === "hudGlow"));
  // CELAH LEGEND<->PLOT (v63): grace 40% di sumbu-y WAJIB ada -- menjamin jarak
  // dari legend ke puncak batang tertinggi + label nilainya walau nilai maks
  // data == nilai maks sumbu otomatis (regresi pernah terjadi: batang/label
  // menimpa legend). Jangan hapus/ubah tanpa audit geometri ulang.
  assert.equal(cfg.options.scales.y.grace, "40%");
});

test("renderBudgetView: daftar kategori -- badge & bar per level, width di-clamp, accordion + sub, stagger delay, format id-ID", () => {
  const { deps, els } = makeViewDeps();
  renderBudgetView(deps);
  const html = els["budget-category-list"].innerHTML;
  // parent 1 (120% -> over, clamp 100)
  assert.match(html, /Over Budget/);
  assert.match(html, /bg-rose-400 transition-all duration-700 ease-out" style="width:100%;"/);
  assert.match(html, /onclick="toggleAccordion\('budget-acc-0'\)"/);
  assert.match(html, /Rincian Sub-kategori/);
  assert.match(html, /Rp 120\.000 <span class="text-slate-300">\/ Rp 100\.000<\/span>/);
  // sub (50% -> safe/Aman)
  assert.match(html, /Aman/);
  assert.match(html, /bg-emerald-400/);
  // parent 2 (75% -> safe, tanpa accordion)
  assert.match(html, /style="animation-delay: 45ms"/); // idx 1 * 45ms (tanpa semicolon di template asli)
  // ikon via categoryIconHtml: di daftar kategori, style sudah MELEKAT di entry
  // (digabung summarizeBudgets lewat opsi getCategoryStyle) -- categoryIconHtml
  // menerima entry itu langsung, bukan hasil getCategoryStyle baru.
  assert.match(html, /fa-utensils/);
});

test("renderBudgetView: entries kosong -> tanpa chart, overlay muncul, CTA 'Buat Anggaran Pertama', pesan ajakan", () => {
  const { deps, els, chartInstances } = makeViewDeps({ _summary: { entries: [], totalBudget: 0, totalActual: 0, remaining: 0, overallPct: 0 } });
  renderBudgetView(deps);
  assert.equal(chartInstances.length, 0);
  assert.equal(els["budgetCompareEmpty"].classList.contains("hidden"), false);
  assert.match(els["budget-status-msg"].innerText, /Yuk mulai atur budget kamu di cloud!/);
  const html = els["budget-category-list"].innerHTML;
  assert.match(html, /Belum ada budget untuk bulan ini/);
  assert.match(html, /onclick="openBudgetModal\(\)"/);
  assert.match(html, /Buat Anggaran Pertama/);
});

test("renderBudgetView: dependency diteruskan apa adanya (globalData, {year,month,txIdrAmount,parseTgl}, cloudBudgets ref, getCategoryStyle)", () => {
  const { deps, domainCalls } = makeViewDeps();
  renderBudgetView(deps);
  assert.equal(domainCalls.agg.data, deps.globalData);
  assert.equal(domainCalls.agg.opts.year, "2026");
  assert.equal(domainCalls.agg.opts.month, "08");
  assert.equal(domainCalls.agg.opts.txIdrAmount, deps.txIdrAmount);
  assert.equal(domainCalls.agg.opts.parseTgl, deps.parseTgl);
  assert.equal(domainCalls.sum.pengeluaran, deps.categoryDict.pengeluaran);
  assert.equal(domainCalls.sum.budgets, deps.cloudBudgets);
  assert.equal(domainCalls.sum.actualMap["Makan di luar"], 30000);
  assert.equal(domainCalls.sum.opts.getCategoryStyle, deps.getCategoryStyle);
});

// ===================== renderBudgetModalList =====================

const categoryDict = {
  pengeluaran: {
    Makanan: { subs: [{ name: "Makan di luar" }, { name: "Groceries" }] },
    Hiburan: {},
  },
};

function makeModalDeps(over = {}) {
  const els = { modalBudgetList: makeEl("modalBudgetList") };
  const doc = { els, getElementById: (id) => els[id] || null };
  const styleCalls = [];
  const iconCalls = [];
  const deps = {
    document: doc,
    categoryDict,
    cloudBudgets: { "Makan di luar": 150000, Groceries: 250000, Hiburan: 100000 },
    slugify,
    getCategoryStyle: (name, jenis) => { styleCalls.push([name, jenis]); return { icon: "fa-custom-" + slugify(name), bg: "bg-x-100", color: "text-x-500" }; },
    categoryIconHtml: (style) => { iconCalls.push(style); return `<i class="${style.icon}"></i>`; },
    escapeHtml,
    ...over,
  };
  return { deps, els, styleCalls, iconCalls };
}

test("renderBudgetModalList: parent TANPA sub -> input editable, value dari cloudBudgets[nama], data-parent + oninput format saja", () => {
  const { deps, els } = makeModalDeps();
  renderBudgetModalList(deps);
  const html = els.modalBudgetList.innerHTML;
  assert.match(html, /id="budget-parent-Hiburan"/);
  assert.match(html, /data-parent="Hiburan"/);
  assert.match(html, /value="100\.000"/);
  assert.match(html, /oninput="formatBudgetInputDisplay\(this\)"/);
  assert.doesNotMatch(html, /id="budget-parent-Hiburan"[^>]*readonly/);
});

test("renderBudgetModalList: parent DGN sub -> readonly + akumulasi nilai sub; sub input dgn data-parentslug & oninput calcBudgetParent", () => {
  const { deps, els } = makeModalDeps();
  renderBudgetModalList(deps);
  const html = els.modalBudgetList.innerHTML;
  assert.match(html, /readonly tabindex="-1" id="budget-parent-Makanan"/); // urutan atribut asli: readonly sebelum id
  assert.match(html, /value="400\.000"/); // 150000 + 250000 ter-akumulasi
  assert.match(html, /Akumulasi sub-kategori/);
  assert.match(html, /id="budget-sub-Makan_di_luar"/);
  assert.match(html, /data-parentslug="Makanan"/);
  assert.match(html, /data-category="Makan di luar"/);
  assert.match(html, /value="150\.000"/);
  assert.match(html, /value="250\.000"/);
  assert.match(html, /oninput="formatBudgetInputDisplay\(this\); calcBudgetParent\('Makanan'\)"/);
});

test("renderBudgetModalList: ikon/warna lewat getCategoryStyle (kustomisasi Pengaturan ikut), bukan mentah categoryDict", () => {
  const { deps, els, styleCalls, iconCalls } = makeModalDeps();
  renderBudgetModalList(deps);
  const html = els.modalBudgetList.innerHTML;
  assert.match(html, /fa-custom-Makanan/); // parent
  assert.match(html, /fa-custom-Groceries/); // sub
  assert.ok(styleCalls.some(([n, j]) => n === "Makan di luar" && j === "Pengeluaran"));
  assert.equal(iconCalls.length, 4); // 2 parent (Makanan, Hiburan) + 2 sub
});

test("renderBudgetModalList: tanpa nilai budget -> value kosong (bukan 0)", () => {
  const { deps, els } = makeModalDeps({ cloudBudgets: {} });
  renderBudgetModalList(deps);
  const html = els.modalBudgetList.innerHTML;
  assert.match(html, /id="budget-parent-Hiburan"[^>]*value=""/);
  assert.match(html, /id="budget-sub-Makan_di_luar"[^>]*value=""/);
});
