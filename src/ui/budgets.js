/**
 * MyFinance UI rendering utk tab Budget: ringkasan total (budget/realisasi/
 * sisa), ring progress SVG, pesan status, chart perbandingan bar Chart.js,
 * daftar kategori budget dgn sub-kategori accordion, serta daftar input di
 * modal "Atur Budget" (renderBudgetModalList).
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, bangun innerHTML, buat instance Chart). Bedanya
 * dengan sebelum dipindah: semua dependency (elemen `document`, data
 * global, helper format/style/animasi, holder chart, kelas Chart, fungsi
 * domain) SEKARANG disuntik lewat 1 objek `ctx`, bukan dibaca dari
 * closure/global langsung -- supaya (a) eksplisit apa saja yang dibutuhkan
 * fungsi ini, (b) tetap bisa dites tanpa browser sungguhan (lihat
 * tests/unit/ui-budgets.test.js: `document` & `Chart` di-stub pakai objek
 * biasa, tidak butuh jsdom/Playwright).
 *
 * Konstanta presentasi BUDGET_USAGE_RING_COLOR/BAR_COLOR/BADGE ikut pindah
 * ke sini (hanya dipakai renderBudgetView). classifyBudgetUsage() di
 * src/domain/budgets.js memang cuma mengembalikan level abstrak
 * ('over'/'warning'/'safe') -- pemetaan ke warna/teks tampilan yang
 * spesifik memang milik presentation layer (file ini), bukan modul domain.
 *
 * Yang SENGAJA TIDAK ikut pindah (tetap fungsi global di index.html karena
 * dirujuk atribut onclick/oninput / adalah action, bukan render):
 * changeBudgetMonth, openBudgetModal, closeBudgetModal,
 * formatBudgetInputDisplay, calcBudgetParent, saveBudgets, toggleAccordion.
 *
 * Chart & charts di-inject per pemanggilan (bukan ditangkap sekali) karena
 * holder `charts` bisa di-reassign utuhnya di index.html (mis. saat ganti
 * tema) -- pola yang sama dgn src/ui/assets.js.
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola kelima setelah
 * src/ui/recurring.js (13d8a37), insights.js (af8b4a2), goals-debts.js
 * (089aa40) & assets.js (7e021b6). Pasangan domain-nya:
 * src/domain/budgets.js (aggregateActualByCategory, summarizeBudgets,
 * classifyBudgetUsage, commit 436e12c).
 */

import { hudBarDataset, hudLineScales, hudGlowPlugin } from "../domain/chart-hud.js";

const BUDGET_USAGE_RING_COLOR = { over: "#fb7185", warning: "#fbbf24", safe: "#34d399" };
const BUDGET_USAGE_BAR_COLOR = { over: "bg-rose-400", warning: "bg-amber-400", safe: "bg-emerald-400" };
const BUDGET_USAGE_BADGE = {
  over: { text: "Over Budget", cls: "bg-rose-100 text-rose-600" },
  warning: { text: "Waspada", cls: "bg-amber-100 text-amber-600" },
  safe: { text: "Aman", cls: "bg-emerald-100 text-emerald-600" },
};

/**
 * Render daftar input budget per kategori pengeluaran di modal "Atur
 * Budget" (elemen `#modalBudgetList`): baris parent (readonly + akumulasi
 * sub kalau punya sub-kategori, editable kalau tidak) + baris sub-kategori.
 * Ikon/warna lewat getCategoryStyle() supaya kustomisasi dari Pengaturan
 * ikut kebawa (lihat catatan BUG FIX di dalam).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{pengeluaran: Record<string, {subs?: Array<{name: string}>}>}} ctx.categoryDict - dict kategori global.
 * @param {Record<string, number>} ctx.cloudBudgets - budget bulan yg sedang dibuka (dibaca).
 * @param {(str: string) => string} ctx.slugify
 * @param {(kategori: string, jenis: string) => object} ctx.getCategoryStyle
 * @param {(style: object, wrapClass?: string, iconSizeClass?: string) => string} ctx.categoryIconHtml
 * @param {(str: string) => string} ctx.escapeHtml
 */
export function renderBudgetModalList({
  document, categoryDict, cloudBudgets, slugify,
  getCategoryStyle, categoryIconHtml, escapeHtml,
}) {
  const wrap = document.getElementById("modalBudgetList");
  const parents = Object.keys(categoryDict.pengeluaran);

  wrap.innerHTML = parents.map(parentName => {
    const parent = categoryDict.pengeluaran[parentName];
    const hasSubs = parent.subs && parent.subs.length > 0;
    const pSlug = slugify(parentName);
    // BUG FIX: sama seperti di renderBudgetView() -- sebelumnya pakai parent.bg/color/icon
    // & sub.icon mentah dari categoryDict, jadi kustomisasi ikon/warna/gambar upload dari
    // Pengaturan tidak ikut kebawa ke modal ini. Pakai getCategoryStyle() supaya sinkron.
    const parentStyle = getCategoryStyle(parentName, "Pengeluaran");

    let parentVal = 0;
    if (!hasSubs) {
      parentVal = cloudBudgets[parentName] || 0;
    } else {
      parent.subs.forEach(sub => { parentVal += (cloudBudgets[sub.name] || 0); });
    }

    let rowHtml = `
        <div class="mt-4 mb-1">
            <div class="flex items-center gap-3 bg-slate-100/70 rounded-2xl p-2.5 ring-1 ring-slate-200">
                ${categoryIconHtml(parentStyle, "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm", "text-xs")}
                <div class="flex-1 min-w-0">
                    <span class="text-xs font-bold text-slate-700 block truncate">${escapeHtml(parentName)}</span>
                    ${hasSubs ? `<span class="text-[10px] text-slate-400 font-semibold">Akumulasi sub-kategori</span>` : ""}
                </div>
                <div class="flex items-center ${hasSubs ? "bg-slate-50" : "bg-white focus-within:ring-indigo-300"} rounded-xl ring-1 ring-slate-200 px-2.5 py-2 flex-shrink-0 w-32 focus-within:ring-2 transition">
                    <span class="text-[10px] text-slate-400 mr-1 flex-shrink-0">Rp</span>
                    <input type="text" ${hasSubs ? `readonly tabindex="-1"` : ""} id="budget-parent-${pSlug}" data-parent="${escapeHtml(parentName)}" value="${parentVal > 0 ? new Intl.NumberFormat("id-ID").format(parentVal) : ""}" placeholder="0" oninput="formatBudgetInputDisplay(this)" class="w-full text-xs font-bold ${hasSubs ? "text-slate-500 cursor-not-allowed" : "text-slate-800"} outline-none bg-transparent text-right budget-parent-input">
                </div>
            </div>
        </div>`;

    if (hasSubs) {
      let subsHtml = `<div class="pl-4 md:pl-8 space-y-1.5 mt-2 border-l-2 border-slate-100 ml-4">`;
      parent.subs.forEach(sub => {
        const subVal = cloudBudgets[sub.name] || "";
        const sSlug = slugify(sub.name);
        const subStyle = getCategoryStyle(sub.name, "Pengeluaran");
        subsHtml += `
            <div class="flex items-center gap-3 bg-white rounded-xl p-2 ring-1 ring-slate-100 shadow-sm">
                ${categoryIconHtml(subStyle, "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", "text-[10px]")}
                <span class="text-[11px] font-bold text-slate-600 flex-1 min-w-0 truncate">${escapeHtml(sub.name)}</span>
                <div class="flex items-center bg-slate-50 rounded-lg ring-1 ring-slate-100 px-2.5 py-1.5 flex-shrink-0 w-28 focus-within:ring-2 focus-within:ring-indigo-300 transition">
                    <span class="text-[10px] text-slate-400 mr-1">Rp</span>
                    <input type="text" inputmode="numeric" id="budget-sub-${sSlug}" data-parentslug="${pSlug}" data-category="${escapeHtml(sub.name)}" value="${subVal ? new Intl.NumberFormat("id-ID").format(subVal) : ""}" placeholder="0" oninput="formatBudgetInputDisplay(this); calcBudgetParent('${pSlug}')" class="w-full text-[11px] font-bold text-slate-800 outline-none bg-transparent text-right budget-input">
                </div>
            </div>`;
      });
      subsHtml += `</div>`;
      rowHtml += subsHtml;
    }
    return rowHtml;
  }).join("");
}

/**
 * Render seluruh tab Budget: totals (plan/actual/remaining), ring progress
 * SVG (warna per level pemakaian), pesan status, chart bar Budget vs
 * Realisasi (Chart.js, dgn overlay empty-state), dan daftar kartu kategori
 * (bar progres + badge + sub-kategori accordion).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {Array<object>} ctx.globalData - semua transaksi (utk agregasi realisasi).
 * @param {(t: object) => number} ctx.txIdrAmount - helper nilai IDR transaksi di index.html.
 * @param {(tanggalStr: string) => Date} ctx.parseTgl - helper parse tanggal di index.html.
 * @param {{pengeluaran: Record<string, object>}} ctx.categoryDict
 * @param {Record<string, number>} ctx.cloudBudgets - budget bulan yg sedang dibuka (dibaca).
 * @param {(kategori: string, jenis: string) => object} ctx.getCategoryStyle
 * @param {(el: object, targetValue: number, maskable?: boolean) => void} ctx.animateRupiah
 * @param {(str: string) => string} ctx.escapeHtml
 * @param {(angka: number) => string} ctx.formatRp
 * @param {(angka: number) => string} ctx.formatShortVal
 * @param {(style: object, wrapClass?: string, iconSizeClass?: string) => string} ctx.categoryIconHtml
 * @param {(bg: string) => string} ctx.chartLabelColor - mapping warna label chart (mode gelap/terang).
 * @param {() => string} ctx.chartGridColor - warna grid chart (mode gelap/terang).
 * @param {Function} ctx.Chart - kelas Chart.js (global browser, di-inject supaya testable).
 * @param {Record<string, object>} ctx.charts - holder instance chart milik index.html (di-inject per pemanggilan).
 * @param {(data: Array<object>, opts: object) => Record<string, number>} ctx.aggregateActualByCategory - dari src/domain/budgets.js (via servicesModule).
 * @param {(pengeluaran: object, budgets: object, actualMap: object, opts: object) => {entries: Array<object>, totalBudget: number, totalActual: number, remaining: number, overallPct: number}} ctx.summarizeBudgets - dari src/domain/budgets.js (via servicesModule).
 * @param {(pct: number) => string} ctx.classifyBudgetUsage - dari src/domain/budgets.js (via servicesModule); mengembalikan 'over'/'warning'/'safe'.
 */
export function renderBudgetView({
  document, globalData, txIdrAmount, parseTgl, categoryDict, cloudBudgets,
  getCategoryStyle, animateRupiah, escapeHtml, formatRp, formatShortVal,
  categoryIconHtml, chartLabelColor, chartGridColor, accentColor, Chart, charts,
  aggregateActualByCategory, summarizeBudgets, classifyBudgetUsage,
}) {
  const monthInput = document.getElementById("budgetFilterMonth"); if (!monthInput) return;
  if (!monthInput.value) { let n = new Date(); monthInput.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
  const targetBulan = monthInput.value;
  const [year, month] = targetBulan.split("-");

  // Agregasi & kalkulasi murni sekarang satu sumber kebenaran di
  // src/domain/budgets.js (dipakai juga oleh tests/unit/budgets-domain.test.js).
  // BUG FIX (dipertahankan dari kode lama): ikon/warna diambil lewat
  // getCategoryStyle() -- bukan langsung dari categoryDict mentah -- supaya
  // kustomisasi ikon/warna/gambar upload dari Pengaturan ikut kebawa ke halaman
  // Budget, bukan selalu tampil ikon+warna bawaan/default.
  const actualCategoryMap = aggregateActualByCategory(globalData, { year, month, txIdrAmount, parseTgl });
  const { entries, totalBudget, totalActual, remaining, overallPct } =
    summarizeBudgets(categoryDict.pengeluaran, cloudBudgets, actualCategoryMap, { getCategoryStyle });

  animateRupiah(document.getElementById("budget-total-plan"), totalBudget);
  animateRupiah(document.getElementById("budget-total-actual"), totalActual);
  const remEl = document.getElementById("budget-total-remaining");
  remEl.innerText = (remaining < 0 ? "-Rp " : "Rp ") + formatRp(Math.abs(remaining));
  remEl.className = "text-xs md:text-lg font-extrabold whitespace-nowrap " + (remaining >= 0 ? "text-emerald-400" : "text-rose-400");

  const ringCircle = document.getElementById("budget-ring-progress");
  const circumference = 2 * Math.PI * 52;
  const safeColor = (accentColor && accentColor("budgetSafe")) || BUDGET_USAGE_RING_COLOR.safe; // null saat aksen tabrakan warning/over -> tetap zamrud asli
  let ringColor = classifyBudgetUsage(overallPct) === "safe" ? safeColor : BUDGET_USAGE_RING_COLOR[classifyBudgetUsage(overallPct)];
  let clampedPct = Math.min(overallPct, 100);
  ringCircle.setAttribute("stroke-dasharray", `${circumference}`);
  ringCircle.setAttribute("stroke-dashoffset", `${circumference - (clampedPct / 100) * circumference}`);
  ringCircle.style.stroke = ringColor;
  document.getElementById("budget-ring-pct").innerText = overallPct + "%";

  const BUDGET_STATUS_MSG = {
    over: "Waduh, pengeluaranmu sudah melebihi budget! 😅",
    warning: "Hati-hati, pengeluaran bulanan hampir habis! ⚠️",
    safe: "Sangat baik! Finansialmu bulan ini sangat terjaga. 🎉",
  };
  const statusEl = document.getElementById("budget-status-msg");
  statusEl.innerText = entries.length === 0
    ? "Yuk mulai atur budget kamu di cloud! ✨"
    : BUDGET_STATUS_MSG[classifyBudgetUsage(overallPct)];

  if (charts.budgetCompare) { charts.budgetCompare.destroy(); charts.budgetCompare = null; }
  const chartCanvas = document.getElementById("budgetCompareChart");
  const emptyOverlay = document.getElementById("budgetCompareEmpty");
  if (entries.length === 0) {
    if (emptyOverlay) emptyOverlay.classList.remove("hidden");
  } else {
    if (emptyOverlay) emptyOverlay.classList.add("hidden");
    if (chartCanvas) {
      // Warna realisasi per kategori (safe/warning/over) dihitung sekali -- dipakai
      // dataset (gradasi) & datalabel, karena backgroundColor kini scriptable.
      const realisasiColors = entries.map(e => classifyBudgetUsage(e.pct) === "safe" ? safeColor : BUDGET_USAGE_RING_COLOR[classifyBudgetUsage(e.pct)]);
      charts.budgetCompare = new Chart(chartCanvas.getContext("2d"), {
        plugins: [hudGlowPlugin], // DNA batang HUD: glow cyan
        type: "bar",
        data: {
          labels: entries.map(e => e.name),
          datasets: [
            { label: "Budget", data: entries.map(e => e.budget), ...hudBarDataset({ from: "#c7d2fe" }) },
            { label: "Realisasi", data: entries.map(e => e.actual), ...hudBarDataset({ from: realisasiColors }) }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
          plugins: {
            legend: { position: "top", labels: { boxWidth: 10, font: { size: 10, weight: "bold" } } },
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
              color: (ctx) => chartLabelColor(ctx.datasetIndex === 0 ? "#c7d2fe" : realisasiColors[ctx.dataIndex]),
              font: { size: 8, weight: "bold" }, formatter: (v) => formatShortVal(v), anchor: "end", align: "top", offset: 2
            },
            tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": Rp " + formatRp(ctx.raw) } }
          },
          scales: hudLineScales(entries.map(e => e.name), formatShortVal, { yGrid: chartGridColor() })
        }
      });
    }
  }

  const listEl = document.getElementById("budget-category-list");
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center shadow-sm">
        <p class="text-3xl mb-2">🎯</p>
        <p class="text-sm font-extrabold text-slate-600 mb-1">Belum ada budget untuk bulan ini</p>
        <p class="text-xs text-slate-400 mb-4">Yuk buat budget pengeluaranmu secara digital agar pengeluaran terkendali!</p>
        <button onclick="openBudgetModal()" class="bg-[#151928] hover:bg-black text-white rounded-xl px-4 py-2.5 text-xs font-bold transition-colors shadow-sm inline-flex items-center gap-2"><i class="fas fa-plus"></i> Buat Anggaran Pertama</button>
    </div>`;
  } else {
    listEl.innerHTML = entries.map((e, idx) => {
      const eLevel = classifyBudgetUsage(e.pct);
      let barColor = BUDGET_USAGE_BAR_COLOR[eLevel];
      let badge = BUDGET_USAGE_BADGE[eLevel];
      let widthPct = Math.min(e.pct, 100);
      const canExpand = e.subEntries && e.subEntries.length > 0;
      const accId = `budget-acc-${idx}`;

      const subHtml = canExpand ? e.subEntries.map(s => {
        const sLevel = classifyBudgetUsage(s.pct);
        let sBarColor = BUDGET_USAGE_BAR_COLOR[sLevel];
        let sBadge = BUDGET_USAGE_BADGE[sLevel];
        let sWidthPct = Math.min(s.pct, 100);
        return `<div class="bg-white rounded-xl p-2.5 ring-1 ring-slate-100 ${s.isDirect ? "border border-dashed border-slate-200" : ""}">
            <div class="flex items-center justify-between mb-2 gap-2">
                <div class="flex items-center min-w-0">
                    ${categoryIconHtml(s, "w-7 h-7 rounded-lg flex items-center justify-center mr-2 flex-shrink-0", "text-[10px]")}
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold text-slate-700 truncate">${escapeHtml(s.name)}</p>
                        <p class="text-[10px] text-slate-400 font-semibold whitespace-nowrap">Rp ${formatRp(s.actual)} <span class="text-slate-300">/ Rp ${formatRp(s.budget)}</span></p>
                    </div>
                </div>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${sBadge.cls}">${sBadge.text}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full ${sBarColor} transition-all duration-700 ease-out" style="width:${sWidthPct}%;"></div>
            </div>
            <p class="text-right text-[10px] font-bold text-slate-400 mt-1">${s.pct}%</p>
        </div>`;
      }).join("") : "";

      return `<div class="stagger-item bg-white rounded-2xl border border-slate-100 shadow-sm transition hover:shadow-md overflow-hidden" style="animation-delay: ${idx * 45}ms">
        <div class="p-4 ${canExpand ? "cursor-pointer select-none" : ""}" ${canExpand ? `onclick="toggleAccordion('${accId}')"` : ""}>
            <div class="flex items-center justify-between mb-2.5 gap-2">
                <div class="flex items-center min-w-0">
                    ${categoryIconHtml(e, "w-9 h-9 rounded-xl flex items-center justify-center mr-3 flex-shrink-0", "text-xs")}
                    <div class="min-w-0">
                        <p class="text-xs md:text-sm font-extrabold text-slate-800 truncate">${escapeHtml(e.name)}</p>
                        <p class="text-[10px] text-slate-400 font-bold whitespace-nowrap">Rp ${formatRp(e.actual)} <span class="text-slate-300">/ Rp ${formatRp(e.budget)}</span></p>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}">${badge.text}</span>
                    ${canExpand ? `<i id="icon-${accId}" class="fas fa-chevron-down text-slate-400 text-[10px] accordion-icon"></i>` : ""}
                </div>
            </div>
            <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full ${barColor} transition-all duration-700 ease-out" style="width:${widthPct}%;"></div>
            </div>
            <p class="text-right text-[10px] font-bold text-slate-400 mt-1">${e.pct}%</p>
        </div>
        ${canExpand ? `<div id="${accId}" class="accordion-content bg-slate-50/60">
            <div class="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100">
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-3 pb-1">Rincian Sub-kategori</p>
                ${subHtml}
            </div>
        </div>` : ""}
    </div>`;
    }).join("");
  }
}
