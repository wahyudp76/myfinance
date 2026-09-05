import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHealthScore, renderInsights, renderInsightCard, buildInsightDetailHtml, openInsightDetail, closeInsightDetail } from "../../src/ui/insights.js";

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

// ===================== Kartu compact & modal detail (redesign) =====================

test("renderInsightCard: memakai `short` (ringkasan singkat), pakai `message` sbg fallback; ada data-insight-idx", () => {
  const a = renderInsightCard({ title: "Pengeluaran naik", message: "Naik 20% dari bulan lalu.", short: "Naik 20%", icon: "fa-chart-line", bg: "bg-orange-100", color: "text-orange-600" }, 3);
  assert.match(a, /data-insight-idx="3"/);
  assert.match(a, /Pengeluaran naik/);
  assert.match(a, /Naik 20%/);           // short dipakai
  assert.match(a, /fa-chart-line/);
  assert.match(a, /bg-orange-100/);
  // gaya horizontal ala KPI ("rata-rata harian, pengeluaran terbesar"): ikon kiri + caption + nilai, sejajar
  assert.match(a, /hud-kpi/);
  assert.match(a, /items-center/);
  assert.match(a, /text-slate-400 font-medium leading-tight truncate/); // caption (title)
  // fallback: tanpa `short` -> pakai message (data lama tetap tampil)
  const b = renderInsightCard({ title: "t", message: "pesan detail", icon: "fa-x", bg: "bg-slate-100", color: "text-slate-600" }, 0);
  assert.match(b, /pesan detail/);
});

test("renderInsightCard: title & isi di-escape (anti-XSS saat nama kategori/akun tak tepercaya)", () => {
  const html = renderInsightCard({ title: "<img src=x onerror=alert(1)>", message: "<script>bad()</script>", icon: "fa-x", bg: "bg-slate-100", color: "text-slate-600" }, 0);
  // escapeHtml mengubah '<' menjadi &lt; -> tag tidak lagi aktif (tidak bisa dieksekusi).
  assert.ok(!html.includes("<script>"), "Tidak boleh ada tag <script> mentah");
  assert.ok(!html.includes("<img"), "Tidak boleh ada tag <img> mentah");
  assert.ok(html.includes("&lt;script&gt;"), "harus ter-encode menjadi &lt;script&gt;");
  assert.ok(html.includes("&lt;img"), "harus ter-encode menjadi &lt;img");
});

test("buildInsightDetailHtml: tampilkan judul + detail whitespace-pre-line + tombol tutup", () => {
  const html = buildInsightDetailHtml({ title: "Pengeluaran Melebihi Pemasukan", short: "Defisit", detail: "Line 1\n\nLine 2\n- poin a\n- poin b", icon: "fa-arrow-trend-down", bg: "bg-rose-100", color: "text-rose-600" });
  assert.match(html, /Pengeluaran Melebihi Pemasukan/);
  assert.match(html, /whitespace-pre-line/);
  assert.match(html, /- poin a/);
  assert.match(html, /data-close-insight/);
  assert.match(html, /fa-xmark/);
});

test("buildInsightDetailHtml: fallback ke message bila tidak ada detail (data lama)", () => {
  const html = buildInsightDetailHtml({ title: "t", message: "pesan fallback", icon: "fa-x", bg: "bg-slate-100", color: "text-slate-600" });
  assert.match(html, /pesan fallback/);
});

test("renderInsights: kartu di-render sebagai grid compact + requestAiInsight(false) tetap dipanggil 1x", () => {
  const calls = [];
  const deps = makeInsightsDeps({
    computeFinancialInsights: () => [
      { icon: "fa-wallet", bg: "bg-amber-100", color: "text-amber-600", title: "A", message: "mA", short: "sA" },
      { icon: "fa-wallet", bg: "bg-amber-100", color: "text-amber-600", title: "B", message: "mB", short: "sB" },
    ],
    requestAiInsight: (...a) => calls.push(a),
  });
  renderInsights(deps);
  const html = deps.document.getElementById("insights-container").innerHTML;
  assert.match(html, /grid grid-cols-2 sm:grid-cols-3/); // grid side-by-side, ala KPI "rata-rata harian"
  assert.match(html, /data-insight-idx="1"/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [false]);
});

test("openInsightDetail / closeInsightDetail: bikin modal di body, set innerHTML, buka lalu tutup", () => {
  // document stub minimal yg mendukung createElement + body (element ber-clasList & addEventListener).
  function makeEl(tag) {
    const el = {
      tagName: tag.toUpperCase(), id: "", className: "", innerHTML: "", style: {},
      classList: {
        _set: new Set(),
        add: (...c) => c.forEach((x) => el.classList._set.add(x)),
        remove: (...c) => c.forEach((x) => el.classList._set.delete(x)),
        contains: (c) => el.classList._set.has(c),
      },
      setAttribute: () => {}, getAttribute: () => null,
      addEventListener: () => {}, removeEventListener: () => {},
    };
    return el;
  }
  const entries = {};
  const doc = {
    getElementById: (id) => entries[id] || null,
    createElement: (tag) => makeEl(tag),
    body: { appendChild: (el) => { entries[el.id] = el; } },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  openInsightDetail(doc, { title: "X", short: "sX", detail: "dX", icon: "fa-x", bg: "bg-slate-100", color: "text-slate-600" });
  const modal = entries["insight-detail-modal"];
  assert.ok(modal, "modal harus dibuat");
  assert.match(modal.innerHTML, /X/);
  assert.match(modal.innerHTML, /dX/);
  assert.ok(modal.classList.contains("flex"), "harus terbuka (flex)");
  closeInsightDetail(doc, modal);
  assert.ok(!modal.classList.contains("flex"), "harus tertutup setelah close");
});

test("openInsightDetail: no-op bila document tak punya body/createElement (aman di test lama)", () => {
  const fakeDoc = { getElementById: () => null };
  assert.doesNotThrow(() => openInsightDetail(fakeDoc, { title: "t" }));
});
