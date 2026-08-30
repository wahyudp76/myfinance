import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRecurringSummary, renderRecurringListModal } from "../../src/ui/recurring.js";

/**
 * Stub `document` minimal -- cuma implementasi getElementById() yang
 * dibutuhkan 2 fungsi ini, tanpa dependensi baru (jsdom dkk). Elemen
 * palsu adalah objek biasa dgn properti yang settable (textContent,
 * className, innerHTML), persis seperti elemen DOM asli yang dipakai.
 */
function makeFakeDocument(elements) {
  return { getElementById: (id) => elements[id] || null };
}

const stubStyle = () => ({ icon: "fa-tag", bg: "bg-slate-100", color: "text-slate-500" });
const categoryIconHtml = (style) => `<div class="${style.bg}"><i class="fas ${style.icon}"></i></div>`;
const escapeHtml = (str) => String(str).replace(/</g, "&lt;");
const jsStr = (str) => String(str).replace(/'/g, "\\'");
const formatRp = (n) => new Intl.NumberFormat("id-ID").format(n);
const RECURRING_FREQ_LABEL = { harian: "Harian", mingguan: "Mingguan", bulanan: "Bulanan", tahunan: "Tahunan" };
const classifyRecurringDueBadge = (nextDueDate, active, todayStr) => {
  const daysLeft = Math.round((new Date(nextDueDate + "T00:00:00") - new Date(todayStr + "T00:00:00")) / 86400000);
  let level = null;
  if (active) { if (daysLeft < 0) level = "overdue"; else if (daysLeft === 0) level = "today"; else if (daysLeft <= 3) level = "soon"; }
  return { daysLeft, level };
};

// ===================== renderRecurringSummary =====================

test("renderRecurringSummary: elemen tidak ditemukan -> tidak error, tidak ngapa2in", () => {
  const doc = makeFakeDocument({});
  assert.doesNotThrow(() => renderRecurringSummary({
    document: doc, globalRecurring: [], todayDateStr: () => "2026-08-24",
    summarizeRecurringStatus: () => ({ activeCount: 0, overdueCount: 0 }),
  }));
});

test("renderRecurringSummary: tidak ada yang aktif -> pesan 'Belum ada transaksi berulang'", () => {
  const el = { textContent: "", className: "" };
  const doc = makeFakeDocument({ "recurring-summary-text": el });
  renderRecurringSummary({
    document: doc, globalRecurring: [], todayDateStr: () => "2026-08-24",
    summarizeRecurringStatus: () => ({ activeCount: 0, overdueCount: 0 }),
  });
  assert.equal(el.textContent, "Belum ada transaksi berulang");
  assert.match(el.className, /text-slate-400/);
});

test("renderRecurringSummary: ada yang overdue -> teks jumlah overdue, warna merah/bold", () => {
  const el = { textContent: "", className: "" };
  const doc = makeFakeDocument({ "recurring-summary-text": el });
  renderRecurringSummary({
    document: doc, globalRecurring: [{}], todayDateStr: () => "2026-08-24",
    summarizeRecurringStatus: () => ({ activeCount: 3, overdueCount: 2 }),
  });
  assert.equal(el.textContent, "2 jatuh tempo hari ini/terlewat");
  assert.match(el.className, /text-rose-500/);
  assert.match(el.className, /font-bold/);
});

test("renderRecurringSummary: aktif tapi tidak ada yang overdue -> teks jumlah aktif, warna netral", () => {
  const el = { textContent: "", className: "" };
  const doc = makeFakeDocument({ "recurring-summary-text": el });
  renderRecurringSummary({
    document: doc, globalRecurring: [{}], todayDateStr: () => "2026-08-24",
    summarizeRecurringStatus: () => ({ activeCount: 5, overdueCount: 0 }),
  });
  assert.equal(el.textContent, "5 aktif");
  assert.match(el.className, /text-slate-400/);
});

// ===================== renderRecurringListModal =====================

function baseDeps(overrides = {}) {
  return {
    todayDateStr: () => "2026-08-24",
    getCategoryStyle: stubStyle,
    categoryIconHtml,
    classifyRecurringDueBadge,
    escapeHtml,
    jsStr,
    formatRp,
    RECURRING_FREQ_LABEL,
    ...overrides,
  };
}

test("renderRecurringListModal: elemen tidak ditemukan -> tidak error", () => {
  const doc = makeFakeDocument({});
  assert.doesNotThrow(() => renderRecurringListModal({ document: doc, globalRecurring: [], ...baseDeps() }));
});

test("renderRecurringListModal: list kosong -> pesan empty-state", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({ document: doc, globalRecurring: [], ...baseDeps() });
  assert.match(el.innerHTML, /Belum ada transaksi berulang/);
});

test("renderRecurringListModal: 1 item -> innerHTML memuat keterangan, nominal, & frekuensi", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({
    document: doc,
    globalRecurring: [{ id: "r1", active: true, jenis: "Pengeluaran", kategori: "Internet", keterangan: "Langganan Internet", jumlah: 350000, frequency: "bulanan", next_due_date: "2026-09-01" }],
    ...baseDeps(),
  });
  assert.match(el.innerHTML, /Langganan Internet/);
  assert.match(el.innerHTML, /350\.000/);
  assert.match(el.innerHTML, /Bulanan/);
  assert.match(el.innerHTML, /-\s*Rp/); // Pengeluaran -> tanda minus
});

test("renderRecurringListModal: item TANPA keterangan -> fallback pakai nama kategori", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({
    document: doc,
    globalRecurring: [{ id: "r1", active: true, jenis: "Pemasukan", kategori: "Gaji", keterangan: "", jumlah: 5000000, frequency: "bulanan", next_due_date: "2026-09-01" }],
    ...baseDeps(),
  });
  assert.match(el.innerHTML, /Gaji/);
  assert.match(el.innerHTML, /\+\s*Rp/); // Pemasukan -> tanda plus
});

test("renderRecurringListModal: item nonaktif -> class opacity-50 disematkan", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({
    document: doc,
    globalRecurring: [{ id: "r1", active: false, jenis: "Pengeluaran", kategori: "Internet", keterangan: "x", jumlah: 100, frequency: "bulanan", next_due_date: "2026-09-01" }],
    ...baseDeps(),
  });
  assert.match(el.innerHTML, /opacity-50/);
});

test("renderRecurringListModal: badge jatuh tempo (overdue/today/soon) muncul sesuai level", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({
    document: doc,
    globalRecurring: [{ id: "r1", active: true, jenis: "Pengeluaran", kategori: "X", keterangan: "X", jumlah: 100, frequency: "harian", next_due_date: "2026-08-24" }], // hari ini
    ...baseDeps(),
  });
  assert.match(el.innerHTML, /Jatuh tempo hari ini/);
});

test("renderRecurringListModal: diurutkan AKTIF dulu, lalu tanggal jatuh tempo terdekat", () => {
  const el = { innerHTML: "" };
  const doc = makeFakeDocument({ "recurring-list-container": el });
  renderRecurringListModal({
    document: doc,
    globalRecurring: [
      { id: "nonaktif", active: false, jenis: "Pengeluaran", kategori: "A", keterangan: "Item Nonaktif", jumlah: 1, frequency: "bulanan", next_due_date: "2026-08-01" },
      { id: "aktif-nanti", active: true, jenis: "Pengeluaran", kategori: "B", keterangan: "Item Aktif Nanti", jumlah: 1, frequency: "bulanan", next_due_date: "2026-09-01" },
      { id: "aktif-duluan", active: true, jenis: "Pengeluaran", kategori: "C", keterangan: "Item Aktif Duluan", jumlah: 1, frequency: "bulanan", next_due_date: "2026-08-25" },
    ],
    ...baseDeps(),
  });
  const idxNonaktif = el.innerHTML.indexOf("Item Nonaktif");
  const idxAktifNanti = el.innerHTML.indexOf("Item Aktif Nanti");
  const idxAktifDuluan = el.innerHTML.indexOf("Item Aktif Duluan");
  assert.ok(idxAktifDuluan < idxAktifNanti, "yang jatuh tempo lebih dulu harus muncul lebih awal");
  assert.ok(idxAktifNanti < idxNonaktif, "yang aktif harus muncul sebelum yang nonaktif");
});
