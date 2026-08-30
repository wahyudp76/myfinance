import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderGoalIconColorPalette, renderGoalsList,
  renderDebtIconColorPalette, renderDebtsList,
} from "../../src/ui/goals-debts.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan fungsi2 ini, tanpa dependensi baru (jsdom dkk). (Pola yang
 * sama dengan tests/unit/ui-recurring.test.js & ui-insights.test.js.)
 */
function makeFakeDocument(elements) {
  return { getElementById: (id) => elements[id] || null };
}

const makeEl = () => ({ innerHTML: "" });
const escapeHtml = (str) => String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ===================== renderGoalIconColorPalette =====================

test("renderGoalIconColorPalette: semua ikon ter-render dgn onclick pickGoalIcon, ikon terpilih diberi highlight", () => {
  const iconWrap = makeEl(), colorWrap = makeEl();
  const doc = makeFakeDocument({ "goal-icon-palette": iconWrap, "goal-color-palette": colorWrap });
  renderGoalIconColorPalette({
    document: doc,
    formState: { icon: "fa-house", bg: "bg-indigo-100", color: "text-indigo-500" },
  });
  assert.match(iconWrap.innerHTML, /onclick="pickGoalIcon\('fa-plane'\)"/);
  assert.match(iconWrap.innerHTML, /onclick="pickGoalIcon\('fa-house'\)"/);
  assert.match(iconWrap.innerHTML, /fa-heart-pulse/); // 10 ikon palet lengkap
  // ikon terpilih (fa-house) dapat bg+color formState + ring indigo
  assert.match(iconWrap.innerHTML, /bg-indigo-100 text-indigo-500 ring-2 ring-offset-1 ring-indigo-400/);
  // ikon lain tampil polos
  assert.match(iconWrap.innerHTML, /bg-slate-50 text-slate-400 hover:bg-slate-100/);
});

test("renderGoalIconColorPalette: warna terpilih diberi centang + ring, onclick pickGoalColor bawa bg & color", () => {
  const iconWrap = makeEl(), colorWrap = makeEl();
  const doc = makeFakeDocument({ "goal-icon-palette": iconWrap, "goal-color-palette": colorWrap });
  renderGoalIconColorPalette({
    document: doc,
    formState: { icon: "fa-piggy-bank", bg: "bg-rose-100", color: "text-rose-500" },
  });
  assert.match(colorWrap.innerHTML, /onclick="pickGoalColor\('bg-indigo-100','text-indigo-500'\)"/);
  assert.match(colorWrap.innerHTML, /onclick="pickGoalColor\('bg-rose-100','text-rose-500'\)"/);
  assert.match(colorWrap.innerHTML, /fa-check text-\[10px\] text-rose-500/); // centang warna terpilih
  assert.match(colorWrap.innerHTML, /ring-2 ring-offset-1 ring-indigo-400/);
});

test("renderGoalIconColorPalette: elemen palet tidak ada -> tetap melempar (perilaku lama tanpa null-guard SENGAJA dipertahankan)", () => {
  const doc = makeFakeDocument({});
  assert.throws(() => renderGoalIconColorPalette({ document: doc, formState: { icon: "a", bg: "b", color: "c" } }));
});

// ===================== renderGoalsList =====================

const goalProgressStub = (over = {}) => ({ pct: 40, sisa: 600000, isDone: false, daysUntilDeadline: 12, ...over });

function goalDeps(over = {}) {
  return {
    document: makeFakeDocument({ "goals-list-container": makeEl() }),
    appSettings: {},
    computeGoalProgress: () => goalProgressStub(),
    escapeHtml,
    ...over,
  };
}

test("renderGoalsList: container tidak ditemukan -> tidak error, tidak ngapa2in", () => {
  assert.doesNotThrow(() => renderGoalsList(goalDeps({ document: makeFakeDocument({}) })));
});

test("renderGoalsList: belum ada tujuan -> pesan kosong khas tab Tujuan", () => {
  const deps = goalDeps();
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.match(html, /Belum ada tujuan keuangan/);
  assert.match(html, /Bikin target pertamamu lewat tombol Tambah Tujuan/);
});

test("renderGoalsList: tujuan berjalan -> bar indigo, persen, sisa dgn format id-ID, tombol Setor Dana + deadline 'hari lagi'", () => {
  const deps = goalDeps({
    appSettings: { financial_goals: [{ id: "g1", nama: "DP Rumah", icon: "fa-house", bg: "bg-indigo-100", color: "text-indigo-500", target: 1000000, terkumpul: 400000 }] },
  });
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.match(html, /bg-indigo-400/);
  assert.match(html, /width:40%/);
  assert.match(html, /40% -- Rp 400\.000/);
  assert.match(html, /dari Rp 1\.000\.000/);
  assert.match(html, /sisa Rp 600\.000/);
  assert.match(html, /onclick="openGoalContributeModal\('g1'\)"/);
  assert.match(html, /\+ Setor Dana/);
  assert.match(html, /12 hari lagi/);
  assert.match(html, /onclick="openGoalModal\(true,'g1'\)"/);
  assert.match(html, /onclick="removeGoal\('g1'\)"/);
});

test("renderGoalsList: deadline hari ini & lewat tenggat -> teks 'Hari ini' / 'Lewat tenggat'", () => {
  const deps = goalDeps({
    appSettings: { financial_goals: [
      { id: "g1", nama: "A", target: 100, terkumpul: 0 },
      { id: "g2", nama: "B", target: 100, terkumpul: 0 },
    ] },
    computeGoalProgress: (g) => goalProgressStub(g.id === "g1" ? { daysUntilDeadline: 0 } : { daysUntilDeadline: -3 }),
  });
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.match(html, /Hari ini/);
  assert.match(html, /Lewat tenggat/);
});

test("renderGoalsList: daysUntilDeadline null -> tanpa baris deadline sama sekali", () => {
  const deps = goalDeps({
    appSettings: { financial_goals: [{ id: "g1", nama: "A", target: 100, terkumpul: 0 }] },
    computeGoalProgress: () => goalProgressStub({ daysUntilDeadline: null }),
  });
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.doesNotMatch(html, /fa-calendar-days/);
});

test("renderGoalsList: tujuan tercapai -> bar & teks emerald, badge 'Tercapai!', tanpa tombol Setor Dana", () => {
  const deps = goalDeps({
    appSettings: { financial_goals: [{ id: "g1", nama: "Laptop", icon: "fa-laptop", bg: "bg-cyan-100", color: "text-cyan-500", target: 500000, terkumpul: 500000 }] },
    computeGoalProgress: () => goalProgressStub({ pct: 100, sisa: 0, isDone: true, daysUntilDeadline: null }),
  });
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.match(html, /bg-emerald-400/);
  assert.match(html, /Tercapai!/);
  assert.doesNotMatch(html, /Setor Dana/);
});

test("renderGoalsList: nama tujuan di-escape", () => {
  const deps = goalDeps({
    appSettings: { financial_goals: [{ id: "g1", nama: "<script>x", target: 100, terkumpul: 0 }] },
  });
  renderGoalsList(deps);
  const html = deps.document.getElementById("goals-list-container").innerHTML;
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x/);
});

// ===================== renderDebtIconColorPalette =====================

test("renderDebtIconColorPalette: ikon terpilih diberi highlight ring rose, onclick pickDebtIcon", () => {
  const iconWrap = makeEl(), colorWrap = makeEl();
  const doc = makeFakeDocument({ "debt-icon-palette": iconWrap, "debt-color-palette": colorWrap });
  renderDebtIconColorPalette({
    document: doc,
    formState: { icon: "fa-car", bg: "bg-rose-100", color: "text-rose-500" },
  });
  assert.match(iconWrap.innerHTML, /onclick="pickDebtIcon\('fa-credit-card'\)"/);
  assert.match(iconWrap.innerHTML, /bg-rose-100 text-rose-500 ring-2 ring-offset-1 ring-rose-400/);
  assert.match(colorWrap.innerHTML, /onclick="pickDebtColor\('bg-orange-100','text-orange-500'\)"/);
});

// ===================== renderDebtsList =====================

function debtDeps(over = {}) {
  return {
    document: makeFakeDocument({ "debts-list-container": makeEl() }),
    appSettings: {},
    computeDebtProgress: () => ({ paidPct: 25, sisa: 750000, isLunas: false, bulanLagi: 8 }),
    escapeHtml,
    ...over,
  };
}

test("renderDebtsList: container tidak ditemukan -> tidak error", () => {
  assert.doesNotThrow(() => renderDebtsList(debtDeps({ document: makeFakeDocument({}) })));
});

test("renderDebtsList: belum ada utang -> pesan kosong khas tab Utang", () => {
  const deps = debtDeps();
  renderDebtsList(deps);
  const html = deps.document.getElementById("debts-list-container").innerHTML;
  assert.match(html, /Belum ada utang\/cicilan tercatat/);
  assert.match(html, /Tambah Utang/);
});

test("renderDebtsList: utang berjalan -> bar rose, '25% terlunasi', sisa format id-ID, estimasi bulan, tombol Bayar Cicilan", () => {
  const deps = debtDeps({
    appSettings: { debts: [{ id: "d1", nama: "Kredit Motor", icon: "fa-motorcycle", bg: "bg-rose-100", color: "text-rose-500" }] },
  });
  renderDebtsList(deps);
  const html = deps.document.getElementById("debts-list-container").innerHTML;
  assert.match(html, /bg-rose-400/);
  assert.match(html, /width:25%/);
  assert.match(html, /25% terlunasi/);
  assert.match(html, /sisa Rp 750\.000/);
  assert.match(html, /~8 bulan lagi \(estimasi\)/);
  assert.match(html, /onclick="openDebtPayModal\('d1'\)"/);
  assert.match(html, /\+ Bayar Cicilan/);
  assert.match(html, /onclick="openDebtModal\(true,'d1'\)"/);
  assert.match(html, /onclick="removeDebt\('d1'\)"/);
});

test("renderDebtsList: lunas -> bar & teks emerald, badge 'Lunas!', tanpa tombol Bayar Cicilan, tanpa estimasi", () => {
  const deps = debtDeps({
    appSettings: { debts: [{ id: "d1", nama: "Paylater", icon: "fa-receipt", bg: "bg-slate-200", color: "text-slate-600" }] },
    computeDebtProgress: () => ({ paidPct: 100, sisa: 0, isLunas: true, bulanLagi: null }),
  });
  renderDebtsList(deps);
  const html = deps.document.getElementById("debts-list-container").innerHTML;
  assert.match(html, /bg-emerald-400/);
  assert.match(html, /Lunas!/);
  assert.doesNotMatch(html, /Bayar Cicilan/);
  assert.doesNotMatch(html, /bulan lagi/);
});
