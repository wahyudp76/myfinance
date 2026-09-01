/**
 * MyFinance UI rendering utk tab Aset & Portofolio: widget Kekayaan Bersih
 * (nilai/utang + bar proporsi), ringkasan total (nilai, modal, return +
 * badge), cuan/rugi terbesar, daftar kartu aset, chart alokasi (doughnut
 * Chart.js) + legenda donut-nya.
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, bangun innerHTML, buat instance Chart). Bedanya
 * dengan sebelum dipindah: semua dependency (elemen `document`, data
 * global, helper format/style/animasi, holder chart, kelas Chart itu
 * sendiri, fungsi domain) SEKARANG disuntik lewat 1 objek `ctx`, bukan
 * dibaca dari closure/global langsung -- supaya (a) eksplisit apa saja
 * yang dibutuhkan fungsi ini, (b) tetap bisa dites tanpa browser
 * sungguhan (lihat tests/unit/ui-assets.test.js: `document` & `Chart`
 * di-stub pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * CATATAN penting soal Chart & charts: Chart.js dimuat via <script> CDN di
 * index.html (global browser), dan `charts` adalah holder global yg bisa
 * DI-REASSIGN utuhnya (mis. saat ganti tema) -- makanya keduanya di-inject
 * PER PEMANGGILAN oleh wrapper di index.html, bukan ditangkap sekali.
 *
 * CATATAN perilaku yang SENGAJA dipertahankan (bukan bug baru): fungsi ini
 * TIDAK punya null-guard elemen (kode lama langsung pakai elemen) --
 * perilaku identik dipertahankan. Urutan render juga sama: widget
 * Kekayaan Bersih PALING AWAL (lihat komentar di dalam), lalu daftar aset,
 * total, performer, chart; pemanggilan renderGoalsList()/renderDebtsList()
 * di akhir TETAP dilakukan wrapper di index.html (fungsi global di sana),
 * bukan modul ini.
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola keempat setelah
 * src/ui/recurring.js (13d8a37), src/ui/insights.js (af8b4a2) &
 * src/ui/goals-debts.js (089aa40). Pasangan domain-nya:
 * src/domain/assets.js (summarizeAssets & computeNetWorth, commit 5080183).
 */

/**
 * Render seluruh tab Aset & Portofolio.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {Array<object>} ctx.globalAssets - data aset global (belum di-summarize).
 * @param {{debts?: Array<object>}} ctx.appSettings - settings global (dibaca .debts utk Kekayaan Bersih).
 * @param {(assets: Array<object>) => {sortedAssets: Array<object>, totalNilai: number, totalModal: number, catMap: Record<string, number>, totalReturn: number, totalReturnPct: number, best: object|null, worst: object|null}} ctx.summarizeAssets -
 *   dari src/domain/assets.js (via servicesModule).
 * @param {(totalNilai: number, debts: Array<object>) => {totalUtangBersih: number, netWorth: number}} ctx.computeNetWorth -
 *   dari src/domain/assets.js (via servicesModule).
 * @param {(el: object, targetValue: number, maskable?: boolean) => void} ctx.animateRupiah - helper animasi angka di index.html.
 * @param {(str: string) => string} ctx.escapeHtml
 * @param {(angka: number) => string} ctx.formatRp
 * @param {(str: string) => string} ctx.jsStr - escape utk dipakai di dalam atribut onclick="...".
 * @param {(platform: string) => string} ctx.getAccountLogo - logo akun/platform (HTML kecil) dari index.html.
 * @param {(kategori: string) => string} ctx.detectAssetCategoryIcon - nama ikon FontAwesome utk kategori aset.
 * @param {(opts: object) => void} ctx.renderDonutBreakdown - renderer legenda donut bersama di index.html.
 * @param {() => string} ctx.chartEmptyColor - warna segmen donut saat kosong (mode gelap/terang).
 * @param {() => string} ctx.chartBorderColor - warna garis pemisah segmen donut.
 * @param {Function} ctx.Chart - kelas Chart.js (global browser, di-inject supaya testable).
 * @param {Record<string, object>} ctx.charts - holder instance chart milik index.html (di-inject per pemanggilan karena bisa di-reassign utuh).
 */
import { hudDonutSegment, hudDonutGlowPlugin } from "../domain/chart-hud.js";

export function renderAssetView({
  document, globalAssets, appSettings,
  summarizeAssets, computeNetWorth,
  animateRupiah, escapeHtml, formatRp, jsStr,
  getAccountLogo, detectAssetCategoryIcon, renderDonutBreakdown,
  chartEmptyColor, chartBorderColor, Chart, charts,
}) {
  // Return per-aset, total nilai/modal per kategori, & best/worst performer: satu
  // sumber kebenaran sekarang src/domain/assets.js (dipakai juga oleh
  // tests/unit/assets-domain.test.js).
  const { sortedAssets, totalNilai, totalModal, catMap, totalReturn, totalReturnPct, best, worst } =
    summarizeAssets(globalAssets);

  // Kekayaan Bersih = total nilai aset SAAT INI dikurangi total SISA utang yang belum
  // lunas: satu sumber kebenaran sekarang src/domain/assets.js (computeNetWorth). Sengaja
  // dihitung & di-render PALING AWAL di sini (sebelum daftar aset/goals/utang/chart di
  // bawah) supaya widget Kekayaan Bersih tetap ter-update walau salah satu bagian lain di
  // fungsi ini gagal render -- lihat fix bug "Kekayaan Bersih macet di Rp 0 padahal ada
  // aset" (dulu kode ini ada di akhir fungsi, jadi ikut batal kalau renderGoalsList()/
  // renderDebtsList() melempar error duluan).
  const { totalUtangBersih, netWorth } = computeNetWorth(totalNilai, appSettings.debts);
  const nwEl = document.getElementById("networth-total");
  nwEl.classList.toggle("text-rose-300", netWorth < 0); // utang lebih besar dari aset -- kasih sinyal visual, bukan cuma angka minus yang gampang keskip
  animateRupiah(nwEl, netWorth);
  animateRupiah(document.getElementById("networth-aset"), totalNilai);
  animateRupiah(document.getElementById("networth-utang"), totalUtangBersih);
  const nwDenom = totalNilai + totalUtangBersih;
  const asetBarPct = nwDenom > 0 ? (totalNilai / nwDenom) * 100 : 100;
  document.getElementById("networth-bar-aset").style.width = asetBarPct + "%";
  document.getElementById("networth-bar-utang").style.width = (100 - asetBarPct) + "%";

  const listEl = document.getElementById("asset-list-container");
  listEl.innerHTML = "";

  if (globalAssets.length === 0) {
    listEl.innerHTML = `
        <div class="py-12 text-center text-slate-400">
            <i class="fas fa-gem text-4xl mb-3 opacity-30"></i>
            <p class="text-sm font-bold text-slate-500">Belum ada aset</p>
            <p class="text-[10px]">Silakan catat investasi kamu melalui tombol Tambah Aset.</p>
        </div>
    `;
  } else {
    let html = "";
    sortedAssets.forEach(a => {
      let colorCls = a.isUp ? "text-emerald-500" : "text-rose-500";
      let bgCls = a.isUp ? "bg-emerald-50" : "bg-rose-50";
      let iconCls = a.isUp ? "fa-arrow-trend-up" : "fa-arrow-trend-down";

      let updateText = a.terakhir ? new Date(a.terakhir).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" }) : "-";

      html += `
        <div onclick="openAssetDetailModal('${jsStr(a.id)}')" class="bg-white rounded-xl p-3 md:p-4 mb-3 border border-slate-100 hover:shadow-md hover:border-indigo-100 transition group cursor-pointer">
            <div class="flex justify-between items-start">
                <div class="flex items-center min-w-0">
                    <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-50 flex items-center justify-center mr-3 flex-shrink-0 shadow-sm border border-white">
                        ${getAccountLogo(a.platform)}
                    </div>
                    <div class="min-w-0">
                        <p class="text-xs md:text-sm font-bold text-slate-800 truncate">${escapeHtml(a.nama)}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                            <span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">${a.kategori}</span>
                            <span class="text-[10px] text-slate-400 truncate">${escapeHtml(a.platform)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center opacity-0 group-hover:opacity-100 transition duration-200">
                    <button onclick="event.stopPropagation(); openAssetModal(true, '${a.id}')" aria-label="Edit" class="w-8 h-8 rounded hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition"><i class="fas fa-pencil-alt text-xs"></i></button>
                    <button onclick="event.stopPropagation(); deleteAssetData('${a.id}')" aria-label="Hapus" class="w-8 h-8 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-500 transition"><i class="fas fa-trash-alt text-xs"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-50">
                <div>
                    <p class="text-[10px] md:text-[10px] font-medium text-slate-400 uppercase">Modal</p>
                    <p class="text-[11px] md:text-xs font-bold text-slate-700">Rp ${formatRp(a.modal)}</p>
                </div>
                <div class="text-right md:text-left">
                    <p class="text-[10px] md:text-[10px] font-medium text-slate-400 uppercase">Sekarang</p>
                    <p class="text-[11px] md:text-xs font-bold text-slate-800">Rp ${formatRp(a.nilai)}</p>
                </div>
                <div class="col-span-2 md:col-span-1 text-right">
                    <p class="text-[10px] md:text-[10px] font-medium text-slate-400 uppercase mb-0.5">Return</p>
                    <span class="inline-flex items-center gap-1 ${bgCls} ${colorCls} px-2 py-0.5 rounded font-bold text-[10px] md:text-[11px]">
                        <i class="fas ${iconCls}"></i> Rp ${formatRp(Math.abs(a.returnRp))} (${Math.abs(a.returnPct).toFixed(1)}%)
                    </span>
                </div>
            </div>
        </div>
    `;
    });
    listEl.innerHTML = html;
  }

  document.getElementById("asset-count").innerText = globalAssets.length;
  animateRupiah(document.getElementById("asset-total-value"), totalNilai);
  animateRupiah(document.getElementById("asset-total-modal"), totalModal);

  let isTotalUp = totalReturn >= 0;

  document.getElementById("asset-total-return").innerText = (isTotalUp ? "+" : "-") + "Rp " + formatRp(Math.abs(totalReturn));
  const badgeEl = document.getElementById("asset-return-badge");
  badgeEl.innerText = (isTotalUp ? "+" : "") + totalReturnPct.toFixed(2) + "%";
  badgeEl.className = `px-2 py-1 rounded-md text-[10px] font-bold ml-2 ${isTotalUp ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`;

  // Cuan/rugi terbesar -- cuma dihitung dari aset yang modalnya > 0 (supaya persentase
  // return-nya bermakna), dan cuma ditampilkan kalau ada minimal 2 aset yang memenuhi itu
  // (lihat src/domain/assets.js: best/worst null kalau kurang dari 2).
  const performerRow = document.getElementById("asset-performer-row");
  if (best && worst) {
    document.getElementById("asset-best-name").textContent = best.nama;
    document.getElementById("asset-best-pct").textContent = (best.pct >= 0 ? "+" : "") + best.pct.toFixed(1) + "%";
    document.getElementById("asset-worst-name").textContent = worst.nama;
    document.getElementById("asset-worst-pct").textContent = (worst.pct >= 0 ? "+" : "") + worst.pct.toFixed(1) + "%";
    performerRow.classList.remove("hidden");
    performerRow.classList.add("grid", "grid-cols-2");
  } else {
    performerRow.classList.add("hidden");
    performerRow.classList.remove("grid", "grid-cols-2");
  }

  let catLabels = Object.keys(catMap);
  let catData = Object.values(catMap);
  let modernPalette = ["#22d3ee", "#34d399", "#a78bfa", "#f472b6", "#fbbf24", "#38bdf8", "#4ade80", "#e879f9"];

  if (charts.assetAlloc) charts.assetAlloc.destroy();
  charts.assetAlloc = new Chart(document.getElementById("assetAllocationChart").getContext("2d"), {
    plugins: [hudDonutGlowPlugin], // DNA donut HUD: glow violet reactor
    type: "doughnut",
    data: {
      labels: catLabels.length ? catLabels : ["Kosong"],
      datasets: [{
        data: catLabels.length ? catData : [1],
        // DNA donut HUD (src/domain/chart-hud.js): segmen gradasi komet; palet tetap sumber warna.
        backgroundColor: hudDonutSegment(catLabels.length ? modernPalette : [chartEmptyColor()]),
        borderWidth: 0, borderRadius: 6, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "70%",
      plugins: { legend: { display: false }, datalabels: { display: false } }
    }
  });
  renderDonutBreakdown({
    legendEl: document.getElementById("assetAllocationChart-legend"),
    listEl: document.getElementById("assetAllocationChart-list"),
    totalEl: document.getElementById("assetAllocationChart-total"),
    entries: catLabels.map((label, i) => ({ label, val: catData[i], iconHtml: `<div class="w-8 h-8 md:w-9 md:h-9 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center flex-shrink-0 text-xs md:text-sm border border-slate-100"><i class="fas ${detectAssetCategoryIcon(label)}"></i></div>` })),
    palette: modernPalette,
    emptyMessage: "Belum ada aset yang dicatat."
  });
}
