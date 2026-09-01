import { test } from "node:test";
import assert from "node:assert/strict";
import { updateCalendarSummary, renderCalendar, openCalendarDetail } from "../../src/ui/calendar.js";

/**
 * Stub `document`/`window` minimal (pola test UI lainnya). window berisi
 * FullCalendar.Calendar palsu yang mencatat konstruksi & urutan render().
 */
function makeClassList() {
  const classes = new Set(["hidden"]);
  return { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: (c) => classes.has(c), _set: classes };
}
const makeEl = (id, extra = {}) => ({ id, innerText: "", innerHTML: "", classList: makeClassList(), ...extra });

function makeDoc() {
  const els = {
    "cal-in": makeEl("cal-in"), "cal-out": makeEl("cal-out"),
    calendar: makeEl("calendar"),
    calendarDetailTitle: makeEl("calendarDetailTitle"),
    calendarDetailContent: makeEl("calendarDetailContent"),
    modalCalendarDetail: makeEl("modalCalendarDetail"),
  };
  return { els, getElementById: (id) => els[id] || null };
}

const parseTgl = (s) => new Date(s + "T00:00:00");
const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = "2026-08-30";
const formatShortVal = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n));
const formatRp = (n) => new Intl.NumberFormat("id-ID").format(n);
const escapeHtml = (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RECURRING_FREQ_LABEL = { bulanan: "Bulanan", tahunan: "Tahunan" };

// ===================== updateCalendarSummary =====================

test("updateCalendarSummary: meneruskan (globalData, viewStart, viewEnd) ke domain & menganimasikan cal-in/cal-out", () => {
  const doc = makeDoc();
  const animateCalls = [];
  const domainCalls = {};
  const vs = new Date(2026, 7, 1), ve = new Date(2026, 7, 31);
  updateCalendarSummary({
    document: doc, globalData: [{ fake: true }],
    computeCalendarMonthSummary: (data, a, b, opts) => { domainCalls.a = [data, a, b, opts]; return { totalIn: 111, totalOut: 222 }; },
    parseTgl, txIdrAmount: (t) => t.jumlah_idr,
    animateRupiah: (el, v) => animateCalls.push([el.id, v]),
  }, vs, ve);
  assert.equal(domainCalls.a[0].length, 1);
  assert.equal(domainCalls.a[1], vs);
  assert.equal(domainCalls.a[2], ve);
  assert.deepEqual(animateCalls, [["cal-in", 111], ["cal-out", 222]]);
});

test("updateCalendarSummary: elemen tidak ada -> tidak error (null-guard kode asli)", () => {
  assert.doesNotThrow(() => updateCalendarSummary({
    document: { getElementById: () => null }, globalData: [],
    computeCalendarMonthSummary: () => ({ totalIn: 0, totalOut: 0 }),
    parseTgl, txIdrAmount: () => 0, animateRupiah: () => { throw new Error("tidak boleh dipanggil"); },
  }, new Date(), new Date()));
});

// ===================== renderCalendar =====================

function makeCalendarHarness(over = {}) {
  const doc = makeDoc();
  const order = [];
  const constructed = [];
  const toasts = [];
  class FakeCalendar {
    constructor(el, config) { this.el = el; this.config = config; constructed.push(this); }
    render() { order.push("render"); }
    destroy() { order.push("destroy"); }
    getDate() { return new Date(2026, 4, 15); }
  }
  const deps = {
    document: doc,
    window: { innerWidth: 1000, FullCalendar: { Calendar: FakeCalendar } },
    data: [],
    loadFullCalendarLib: async () => {},
    showErrorToast: (m) => toasts.push(m),
    buildDailyCashflowMap: () => ({ "2026-08-29": { in: 50000, out: 0, transfer: 0 }, "2026-08-30": { in: 0, out: 25000, transfer: 0 }, "2026-08-28": { in: 0, out: 0, transfer: 75000 } }),
    txIdrAmount: (t) => t.jumlah_idr,
    formatShortVal,
    globalRecurring: [],
    projectRecurringDueDates: () => [],
    advanceDueDate: (item) => item.next_due_date,
    toDateStr, todayDateStr: () => TODAY,
    calendarInstance: null,
    onInstanceReady: (instance, isMobile) => { order.push("ready:" + isMobile); },
    updateCalendarSummary: () => {},
    openCalendarDetail: () => {},
    ...over,
  };
  return { deps, doc, order, constructed, toasts };
}

test("renderCalendar: loader gagal -> console.error + toast error, TIDAK membuat instance & TIDAK onInstanceReady", async () => {
  const { deps, constructed, toasts } = makeCalendarHarness({ loadFullCalendarLib: async () => { throw new Error("CDN down"); } });
  const errors = [];
  const orig = console.error; console.error = (e) => errors.push(e);
  // Pemulihan console.error yang disengaja di finally; tes berjalan berurutan.
  // eslint-disable-next-line require-atomic-updates
  try { await renderCalendar(deps); } finally { console.error = orig; }
  assert.equal(errors.length, 1);
  assert.match(toasts[0], /Gagal memuat komponen kalender/);
  assert.equal(constructed.length, 0);
});

test("renderCalendar: event arus kas -- masuk hijau '+', keluar merah '-', transfer biru '⇄', nilai 0 tidak jadi event", async () => {
  const { deps, constructed } = makeCalendarHarness();
  await renderCalendar(deps);
  const events = constructed[0].config.events;
  assert.deepEqual(events.find(e => e.start === "2026-08-29"), { title: "+50K", start: "2026-08-29", backgroundColor: "#d1fae5", textColor: "#059669" });
  assert.deepEqual(events.find(e => e.start === "2026-08-30"), { title: "-25K", start: "2026-08-30", backgroundColor: "#ffe4e6", textColor: "#e11d48" });
  assert.deepEqual(events.find(e => e.start === "2026-08-28"), { title: "⇄75K", start: "2026-08-28", backgroundColor: "#dbeafe", textColor: "#2563eb" });
  assert.equal(events.length, 3);
});

test("renderCalendar: proyeksi recurring -- hanya yg active, prefix per jenis, classNames + extendedProps, ceiling ~2 tahun", async () => {
  const projCalls = [];
  const { deps, constructed } = makeCalendarHarness({
    globalRecurring: [
      { active: true, jenis: "Pengeluaran", jumlah: 150000, keterangan: "Netflix", kategori: "Hiburan", frequency: "bulanan", next_due_date: "2026-09-05" },
      { active: false, jenis: "Pemasukan", jumlah: 999, keterangan: "mati", kategori: "X", frequency: "bulanan", next_due_date: "2026-09-05" },
    ],
    projectRecurringDueDates: (item, opts) => { projCalls.push({ item, opts }); return ["2026-09-05", "2026-10-05"]; },
  });
  await renderCalendar(deps);
  assert.equal(projCalls.length, 1); // hanya yg active
  assert.equal(projCalls[0].opts.advanceDueDate, deps.advanceDueDate);
  assert.match(projCalls[0].opts.untilDateStr, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(projCalls[0].opts.untilDateStr >= "2028-08-29"); // ~2 tahun dari 2026-08-30
  const projected = constructed[0].config.events.filter(e => e.classNames);
  assert.equal(projected.length, 2);
  assert.deepEqual(projected[0], {
    title: "-150K", start: "2026-09-05", classNames: ["cal-event-projected"],
    extendedProps: { isProjected: true, recurringLabel: "Netflix", frequency: "bulanan" },
  });
});

test("renderCalendar: instance lama di-destroy, preservedDate jadi initialDate; onInstanceReady dipanggil SEBELUM .render()", async () => {
  const { deps, order, constructed } = makeCalendarHarness();
  const oldInstance = { destroy: () => order.push("destroy"), getDate: () => new Date(2026, 4, 15) };
  deps.calendarInstance = oldInstance;
  await renderCalendar(deps);
  assert.equal(order[0], "destroy");
  assert.equal(constructed[0].config.initialDate.getTime(), new Date(2026, 4, 15).getTime());
  assert.deepEqual(order.slice(1), ["ready:false", "render"]); // desktop -> false
});

test("renderCalendar: desktop vs mobile -- aspectRatio & headerToolbar beda", async () => {
  const desktop = makeCalendarHarness();
  await renderCalendar(desktop.deps);
  const dcfg = desktop.constructed[0].config;
  assert.equal(dcfg.aspectRatio, 1.35);
  assert.deepEqual(dcfg.headerToolbar, { left: "prev,next", center: "title", right: "today" });

  const mobile = makeCalendarHarness({ window: { innerWidth: 500, FullCalendar: { Calendar: class { constructor(el, config) { mobile.constructed.push({ config }); } render() {} } } } });
  // (harness di-remake dgn window sempit; FakeCalendar kedua mencatat ke constructed mobile)
  await renderCalendar(mobile.deps);
  const mcfg = mobile.constructed[0].config;
  assert.equal(mcfg.aspectRatio, 0.7);
  assert.deepEqual(mcfg.headerToolbar, { left: "title", center: "", right: "prev,next" });
});

test("renderCalendar: eventContent -- proyeksi dapat html ikon repeat, transaksi asli return true", async () => {
  const { deps, constructed } = makeCalendarHarness();
  await renderCalendar(deps);
  const eventContent = constructed[0].config.eventContent;
  const html = eventContent({ event: { extendedProps: { isProjected: true }, title: "-150K" } });
  assert.deepEqual(html, { html: `<div class="cal-event-projected-inner"><i class="fas fa-repeat"></i>-150K</div>` });
  assert.equal(eventContent({ event: { extendedProps: {}, title: "+50K" } }), true);
});

test("renderCalendar: dayCellClassNames -- net positif/negatif/nol & tanpa data & hari ini", async () => {
  const { deps, constructed } = makeCalendarHarness();
  await renderCalendar(deps);
  const fn = constructed[0].config.dayCellClassNames;
  const d = (s) => new Date(s + "T00:00:00");
  assert.deepEqual(fn({ date: d("2026-08-29") }), ["cal-day-positive"]);  // in 50000
  assert.deepEqual(fn({ date: d("2026-08-30") }), []);                     // hari ini (out 25000) -> diabaikan
  assert.deepEqual(fn({ date: d("2026-08-28") }), []);                     // transfer saja -> net 0
  assert.deepEqual(fn({ date: d("2026-08-27") }), []);                     // tanpa data
});

test("renderCalendar: datesSet -> updateCalendarSummary(viewStart, viewEnd); dateClick/eventClick -> openCalendarDetail", async () => {
  const summaryCalls = [];
  const detailCalls = [];
  const { deps, constructed } = makeCalendarHarness({
    updateCalendarSummary: (a, b) => summaryCalls.push([a, b]),
    openCalendarDetail: (s) => detailCalls.push(s),
  });
  await renderCalendar(deps);
  const cfg = constructed[0].config;
  const vs = new Date(2026, 7, 1), ve = new Date(2026, 8, 1);
  cfg.datesSet({ view: { currentStart: vs, currentEnd: ve } });
  assert.deepEqual(summaryCalls, [[vs, ve]]);
  cfg.dateClick({ dateStr: "2026-08-30" });
  assert.deepEqual(detailCalls, ["2026-08-30"]);
  cfg.eventClick({ event: { startStr: "2026-08-29T00:00:00" } });
  assert.deepEqual(detailCalls, ["2026-08-30", "2026-08-29"]);
});

// ===================== openCalendarDetail =====================

function makeDetailDeps(over = {}) {
  const doc = makeDoc();
  const deps = {
    document: doc,
    dateStr: "2026-08-05",
    parseTgl, globalData: [], todayDateStr: () => TODAY, globalRecurring: [],
    projectRecurringDueDates: () => [],
    advanceDueDate: (item) => item.next_due_date,
    getCategoryStyle: (k) => ({ icon: "fa-" + k, bg: "bg-slate-100", color: "text-slate-600" }),
    categoryIconHtml: (s) => `<i class="${s.icon}"></i>`,
    escapeHtml, getAccountLogo: (p) => `<i data-p="${p}"></i>`, formatRp, RECURRING_FREQ_LABEL,
    ...over,
  };
  return { deps, doc };
}

test("openCalendarDetail: judul 'Transaksi ' + tanggal panjang id-ID", () => {
  const { deps, doc } = makeDetailDeps();
  openCalendarDetail(deps);
  assert.equal(doc.els.calendarDetailTitle.innerText, "Transaksi 5 Agustus 2026");
});

test("openCalendarDetail: hari kosong (masa lalu) -> 'Tidak ada transaksi.' + modal dibuka", () => {
  const { deps, doc } = makeDetailDeps();
  openCalendarDetail(deps);
  assert.match(doc.els.calendarDetailContent.innerHTML, /Tidak ada transaksi\./);
  assert.equal(doc.els.modalCalendarDetail.classList.contains("hidden"), false);
});

test("openCalendarDetail: baris transaksi -- Transfer berjudul 'Transfer ke X', mata uang asli tampil dgn prefix, akun + keterangan di-escape", () => {
  const { deps, doc } = makeDetailDeps({
    globalData: [
      { tanggal: "2026-08-05", jenis: "Transfer", kategori: "GoPay", akun: "Bank BCA", keterangan: "top up <em>", jumlah: 100000, mata_uang: null },
      { tanggal: "2026-08-05", jenis: "Pengeluaran", kategori: "Makanan", akun: "Tunai (Cash)", keterangan: "", jumlah: 25, mata_uang: "USD" },
    ],
  });
  openCalendarDetail(deps);
  const html = doc.els.calendarDetailContent.innerHTML;
  assert.match(html, /Transfer ke GoPay/);
  assert.match(html, /USD 25/);           // non-IDR prefix
  assert.match(html, /Rp 100\.000/);      // IDR prefix
  assert.match(html, /&lt;em&gt;/);       // keterangan di-escape
  assert.doesNotMatch(html, /Terjadwal/); // masa lalu -> tanpa seksi proyeksi
});

test("openCalendarDetail: tanggal DEPAN dgn recurring jatuh tempo -> seksi 'Terjadwal (belum tercatat)' + frekuensi + nominal violet; yg tidak jatuh tempo tidak ikut", () => {
  const { deps, doc } = makeDetailDeps({
    dateStr: "2026-09-05",
    globalRecurring: [
      { active: true, jenis: "Pengeluaran", keterangan: "Netflix", kategori: "Hiburan", frequency: "bulanan", jumlah: 54000, next_due_date: "2026-09-05" },
      { active: true, jenis: "Pemasukan", keterangan: "", kategori: "Gaji", frequency: "bulanan", jumlah: 5000000, next_due_date: "2026-09-25" },
    ],
    projectRecurringDueDates: (item) => (item.kategori === "Hiburan" ? ["2026-09-05"] : ["2026-09-25"]),
  });
  openCalendarDetail(deps);
  const html = doc.els.calendarDetailContent.innerHTML;
  assert.match(html, /Terjadwal \(belum tercatat\)/);
  assert.match(html, /Netflix/);
  assert.match(html, /Bulanan/);                    // RECURRING_FREQ_LABEL mapping
  assert.match(html, /-Rp 54\.000/);
  assert.match(html, /text-violet-400/);
  assert.doesNotMatch(html, /Gaji/);                // tidak jatuh tempo di tanggal ini
  // tanpa transaksi asli -> header tanpa border-t
  assert.doesNotMatch(html, /border-t border-slate-100 mt-2/);
});
