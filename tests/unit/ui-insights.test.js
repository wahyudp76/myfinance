import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHealthScore, renderInsights } from "../../src/ui/insights.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan 2 fungsi ini, tanpa dependensi baru (jsdom dkk). Elemen
 * palsu adalah objek biasa dgn properti yang settable (innerText,
 * innerHTML, className, style), persis seperti elemen DOM asli yang
 * dipakai. (Pola yang sama dengan tests/unit/ui-recurring.test.js.)
 */
function makeFakeDocument(elements) {
  return { getElementById: (id) => elements[id] || null };
}

const makeEl = () => ({ innerText: "", innerHTML: "", className: "", style: {} });

function makeHealthDeps(scoreResult, overrides = {}) {
  return {
    document: makeFakeDocument({
      "health-score-number": makeEl(),
      "health-score-bar": makeEl(),
      "health-score-label": makeEl(),
      "health-score-breakdown": makeEl(),
    }),
    dataCtx: {},
    currentMonthBudgets: {},
    computeFinancialHealthScore: () => scoreResult,
    ...overrides,
  };
}

// ===================== renderHealthScore =====================

test("renderHealthScore: elemen tidak ditemukan -> tidak error, tidak ngapa2in", () => {
  assert.doesNotThrow(() => renderHealthScore(makeHealthDeps({ finalScore: 80, components: [] }, { document: makeFakeDocument({}) })));
});

test("renderHealthScore: skor >= 75 -> band 'Sehat' hijau, angka & lebar bar sesuai skor", () => {
  const deps = makeHealthDeps({ finalScore: 82, components: [] });
  renderHealthScore(deps);
  const num = deps.document.getElementById("health-score-number");
  const bar = deps.document.getElementById("health-score-bar");
  const label = deps.document.getElementById("health-score-label");
  assert.equal(num.innerText, 82);
  assert.equal(bar.style.width, "82%");
  assert.equal(label.innerText, "Sehat");
  assert.equal(bar.style.background, "#10b981");
  assert.match(label.className, /bg-emerald-100/);
});

test("renderHealthScore: skor 50-74 -> band 'Perlu Perhatian' amber (batas 50 termasuk)", () => {
  const deps = makeHealthDeps({ finalScore: 50, components: [] });
  renderHealthScore(deps);
  assert.equal(deps.document.getElementById("health-score-label").innerText, "Perlu Perhatian");
  assert.equal(deps.document.getElementById("health-score-bar").style.background, "#f59e0b");
});

test("renderHealthScore: skor < 50 -> band 'Kritis' rose", () => {
  const deps = makeHealthDeps({ finalScore: 49, components: [] });
  renderHealthScore(deps);
  assert.equal(deps.document.getElementById("health-score-label").innerText, "Kritis");
  assert.match(deps.document.getElementById("health-score-label").className, /bg-rose-100/);
});

test("renderHealthScore: rincian komponen -> persen dibulatkan; max 0 -> 0%", () => {
  const deps = makeHealthDeps({
    finalScore: 70,
    components: [
      { label: "Rasio Tabungan", score: 8, max: 10 },
      { label: "Kepatuhan Anggaran", score: 3, max: 10 },
      { label: "Dana Darurat", score: 0, max: 0 },
    ],
  });
  renderHealthScore(deps);
  const html = deps.document.getElementById("health-score-breakdown").innerHTML;
  assert.match(html, /Rasio Tabungan<\/span><span[^>]*>80%/);
  assert.match(html, /Kepatuhan Anggaran<\/span><span[^>]*>30%/);
  assert.match(html, /Dana Darurat<\/span><span[^>]*>0%/);
});

test("renderHealthScore: dataCtx & currentMonthBudgets diteruskan ke fungsi domain", () => {
  const calls = [];
  const deps = makeHealthDeps(null, {
    dataCtx: { monthTxCount: 7 },
    currentMonthBudgets: { makanan: 500000 },
    computeFinancialHealthScore: (dataCtx, opts) => {
      calls.push({ dataCtx, opts });
      return { finalScore: 90, components: [] };
    },
  });
  renderHealthScore(deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dataCtx.monthTxCount, 7);
  assert.equal(calls[0].opts.currentMonthBudgets.makanan, 500000);
});

// ===================== renderInsights =====================

function makeInsightsDeps(overrides = {}) {
  return {
    document: makeFakeDocument({ "insights-container": makeEl() }),
    dataCtx: { monthTxCount: 5 },
    currentMonthBudgets: {},
    computeFinancialInsights: () => [],
    formatRp: (n) => `Rp${n}`,
    formatShortVal: (n) => String(n),
    requestAiInsight: () => {},
    ...overrides,
  };
}

test("renderInsights: container tidak ditemukan -> tidak error, requestAiInsight TIDAK dipanggil", () => {
  const calls = [];
  assert.doesNotThrow(() => renderInsights(makeInsightsDeps({
    document: makeFakeDocument({}),
    computeFinancialInsights: () => [{ icon: "fa-wallet", bg: "bg-amber-100", color: "text-amber-600", title: "t", message: "m" }],
    requestAiInsight: (...a) => calls.push(a),
  })));
  assert.equal(calls.length, 0);
});

test("renderInsights: daftar kosong + ada transaksi bulan ini -> pesan 'terlihat stabil'", () => {
  const deps = makeInsightsDeps({ dataCtx: { monthTxCount: 3 }, computeFinancialInsights: () => [] });
  renderInsights(deps);
  const html = deps.document.getElementById("insights-container").innerHTML;
  assert.match(html, /Belum ada hal mencolok bulan ini/);
  assert.match(html, /terlihat stabil/);
});

test("renderInsights: daftar kosong + belum ada transaksi -> pesan 'Belum ada transaksi bulan ini'", () => {
  const deps = makeInsightsDeps({ dataCtx: { monthTxCount: 0 }, computeFinancialInsights: () => [] });
  renderInsights(deps);
  const html = deps.document.getElementById("insights-container").innerHTML;
  assert.match(html, /Belum ada transaksi bulan ini/);
  assert.match(html, /Wawasan akan muncul begitu ada transaksi tercatat/);
});

test("renderInsights: daftar kosong -> requestAiInsight TIDAK dipanggil (persis kode lama)", () => {
  const calls = [];
  const deps = makeInsightsDeps({ computeFinancialInsights: () => [], requestAiInsight: (...a) => calls.push(a) });
  renderInsights(deps);
  assert.equal(calls.length, 0);
});

test("renderInsights: daftar terisi -> kartu per-insight + requestAiInsight(false) dipanggil 1x", () => {
  const calls = [];
  const deps = makeInsightsDeps({
    computeFinancialInsights: () => [
      { icon: "fa-wallet", bg: "bg-amber-100", color: "text-amber-600", title: "Pengeluaran naik", message: "Naik 20% dari bulan lalu." },
      { icon: "fa-piggy-bank", bg: "bg-emerald-100", color: "text-emerald-600", title: "Tabungan bagus", message: "Rasio tabungan 30%." },
    ],
    requestAiInsight: (...a) => calls.push(a),
  });
  renderInsights(deps);
  const html = deps.document.getElementById("insights-container").innerHTML;
  assert.match(html, /Pengeluaran naik/);
  assert.match(html, /Naik 20% dari bulan lalu/);
  assert.match(html, /Tabungan bagus/);
  assert.match(html, /bg-amber-100/);
  assert.match(html, /fa-piggy-bank/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [false]);
});

test("renderInsights: dataCtx, currentMonthBudgets, formatRp & formatShortVal diteruskan ke fungsi domain", () => {
  const calls = [];
  const deps = makeInsightsDeps({
    dataCtx: { monthTxCount: 9 },
    currentMonthBudgets: { transportasi: 200000 },
    computeFinancialInsights: (dataCtx, opts) => {
      calls.push({ dataCtx, opts });
      return [];
    },
  });
  renderInsights(deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dataCtx.monthTxCount, 9);
  assert.equal(calls[0].opts.currentMonthBudgets.transportasi, 200000);
  assert.equal(calls[0].opts.formatRp(1500), "Rp1500");
  assert.equal(calls[0].opts.formatShortVal(42), "42");
});
