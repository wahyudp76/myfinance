/**
 * MyFinance UI rendering untuk Tujuan Keuangan (Financial Goals) &
 * Utang & Cicilan (Debt Tracker): palet ikon/warna di form dan daftar
 * kartu tujuan/utang di tab masing-masing.
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, bangun innerHTML). Bedanya dengan sebelum
 * dipindah: semua dependency (elemen `document`, state form, data
 * appSettings, helper escape, fungsi domain) SEKARANG disuntik lewat 1
 * objek `ctx`, bukan dibaca dari closure/global langsung -- supaya (a)
 * eksplisit apa saja yang dibutuhkan fungsi ini, (b) tetap bisa dites
 * tanpa browser sungguhan (lihat tests/unit/ui-goals-debts.test.js,
 * `document` di-stub pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * Konstanta palet (goalIconPalette/goalColorPalette/debtIconPalette/
 * debtColorPalette) ikut pindah ke sini karena HANYA dipakai fungsi
 * palet di file ini.
 *
 * CATATAN perilaku yang SENGAJA dipertahankan (bukan bug baru):
 * renderGoalIconColorPalette/renderDebtIconColorPalette TIDAK punya
 * null-guard -- kode lama langsung .innerHTML tanpa cek elemen, jadi
 * kalau elemen palet tidak ada ia memang melempar error. Perilaku
 * dipertahankan 100% sama -- ini pemindahan, bukan penulisan ulang.
 *
 * index.html memanggil fungsi2 ini lewat wrapper tipis bernama sama
 * supaya SEMUA pemanggil lama (termasuk atribut onclick="..." di HTML
 * utk tombol pilih ikon/warna, edit, hapus, setor dana, bayar cicilan)
 * tidak perlu diubah sama sekali. State form (goalFormState/
 * debtFormState) tetap dimiliki index.html dan di-mutasi oleh
 * pickGoalIcon/pickGoalColor/pickDebtIcon/pickDebtColor di sana --
 * modul ini hanya MEMBACANYA lewat ctx.
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola ketiga setelah
 * src/ui/recurring.js (13d8a37) & src/ui/insights.js (af8b4a2).
 * Pasangan domain-nya: src/domain/goals-debts.js (computeGoalProgress &
 * computeDebtProgress, commit a9311c8).
 */

const goalIconPalette = ["fa-plane", "fa-house", "fa-car", "fa-graduation-cap", "fa-ring", "fa-piggy-bank", "fa-laptop", "fa-umbrella-beach", "fa-gift", "fa-heart-pulse"];
const goalColorPalette = [
  { bg: "bg-indigo-100", color: "text-indigo-500" }, { bg: "bg-rose-100", color: "text-rose-500" },
  { bg: "bg-emerald-100", color: "text-emerald-500" }, { bg: "bg-amber-100", color: "text-amber-500" },
  { bg: "bg-cyan-100", color: "text-cyan-500" }, { bg: "bg-purple-100", color: "text-purple-500" }
];

const debtIconPalette = ["fa-credit-card", "fa-car", "fa-house", "fa-motorcycle", "fa-graduation-cap", "fa-file-invoice-dollar", "fa-hand-holding-dollar", "fa-mobile-screen", "fa-briefcase", "fa-receipt"];
const debtColorPalette = [
  { bg: "bg-rose-100", color: "text-rose-500" }, { bg: "bg-orange-100", color: "text-orange-500" },
  { bg: "bg-amber-100", color: "text-amber-500" }, { bg: "bg-slate-200", color: "text-slate-600" },
  { bg: "bg-pink-100", color: "text-pink-500" }, { bg: "bg-purple-100", color: "text-purple-500" }
];

/**
 * Render palet pemilih ikon & warna di form Tujuan Keuangan (elemen
 * `#goal-icon-palette` & `#goal-color-palette`): ikon terpilih diberi
 * background/teks warna pilihan user + ring, warna terpilih diberi
 * centang.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{icon: string, bg: string, color: string}} ctx.formState - goalFormState di index.html (dibaca, tidak di-mutasi).
 */
export function renderGoalIconColorPalette({ document, formState }) {
  const iconWrap = document.getElementById("goal-icon-palette");
  iconWrap.innerHTML = goalIconPalette.map(ic => `
        <button type="button" onclick="pickGoalIcon('${ic}')" class="w-full aspect-square rounded-xl flex items-center justify-center transition ${ic === formState.icon ? formState.bg + " " + formState.color + " ring-2 ring-offset-1 ring-indigo-400" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}">
            <i class="fas ${ic} text-sm"></i>
        </button>`).join("");
  const colorWrap = document.getElementById("goal-color-palette");
  colorWrap.innerHTML = goalColorPalette.map(c => `
        <button type="button" onclick="pickGoalColor('${c.bg}','${c.color}')" class="w-8 h-8 rounded-full ${c.bg} flex items-center justify-center transition ${c.bg === formState.bg ? "ring-2 ring-offset-1 ring-indigo-400" : ""}">
            ${c.bg === formState.bg ? `<i class="fas fa-check text-[10px] ${c.color}"></i>` : ""}
        </button>`).join("");
}

/**
 * Render daftar kartu Tujuan Keuangan (elemen `#goals-list-container`):
 * progres persen + bar, sisa dana, badge deadline, tombol setor dana /
 * status Tercapai. Perhitungan progres satu sumber kebenaran di
 * src/domain/goals-debts.js (computeGoalProgress, via servicesModule).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{financial_goals?: Array<object>}} ctx.appSettings - settings global (dibaca .financial_goals).
 * @param {(goal: object, now: Date) => {pct: number, sisa: number, isDone: boolean, daysUntilDeadline: number|null}} ctx.computeGoalProgress -
 *   dari src/domain/goals-debts.js (via servicesModule).
 * @param {(str: string) => string} ctx.escapeHtml
 */
export function renderGoalsList({ document, appSettings, computeGoalProgress, escapeHtml }) {
  const listEl = document.getElementById("goals-list-container"); if (!listEl) return;
  const goals = appSettings.financial_goals || [];
  if (goals.length === 0) {
    listEl.innerHTML = `
        <div class="col-span-1 md:col-span-2 py-12 text-center text-slate-400 stagger-item">
            <i class="fas fa-bullseye text-4xl mb-3 opacity-30"></i>
            <p class="text-sm font-bold text-slate-500">Belum ada tujuan keuangan</p>
            <p class="text-[10px]">Bikin target pertamamu lewat tombol Tambah Tujuan.</p>
        </div>`;
    return;
  }
  listEl.innerHTML = goals.map(g => {
    // Progres (persen, sisa, status selesai, sisa hari ke deadline): satu sumber
    // kebenaran sekarang src/domain/goals-debts.js (computeGoalProgress).
    const { pct, sisa, isDone, daysUntilDeadline } = computeGoalProgress(g, new Date());
    let deadlineHtml = "";
    if (daysUntilDeadline !== null) {
      deadlineHtml = `<span class="text-[10px] text-slate-400 flex items-center gap-1"><i class="fas fa-calendar-days"></i> ${daysUntilDeadline > 0 ? daysUntilDeadline + " hari lagi" : (daysUntilDeadline === 0 ? "Hari ini" : "Lewat tenggat")}</span>`;
    }
    return `
    <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm stagger-item">
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center min-w-0">
                <div class="w-10 h-10 rounded-xl ${g.bg} ${g.color} flex items-center justify-center mr-3 flex-shrink-0"><i class="fas ${g.icon}"></i></div>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(g.nama)}</p>
                    ${deadlineHtml}
                </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <button onclick="openGoalModal(true,'${g.id}')" aria-label="Ubah tujuan" class="w-7 h-7 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-pencil text-[10px]"></i></button>
                <button onclick="removeGoal('${g.id}')" aria-label="Hapus tujuan" class="w-7 h-7 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-trash text-[10px]"></i></button>
            </div>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
            <div class="h-full rounded-full ${isDone ? "bg-emerald-400" : "bg-indigo-400"} transition-all" style="width:${pct}%"></div>
        </div>
        <div class="flex items-center justify-between mb-3">
            <span class="text-[11px] font-bold ${isDone ? "text-emerald-500" : "text-slate-500"}">${pct}% -- Rp ${new Intl.NumberFormat("id-ID").format(g.terkumpul)}</span>
            <span class="text-[10px] text-slate-400">dari Rp ${new Intl.NumberFormat("id-ID").format(g.target)}</span>
        </div>
        ${isDone
            ? `<div class="w-full bg-emerald-50 text-emerald-600 text-center text-xs font-bold py-2.5 rounded-xl"><i class="fas fa-circle-check mr-1.5"></i>Tercapai!</div>`
            : `<button onclick="openGoalContributeModal('${g.id}')" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2.5 rounded-xl transition active:scale-95">+ Setor Dana <span class="text-slate-400 font-normal">(sisa Rp ${new Intl.NumberFormat("id-ID").format(sisa)})</span></button>`}
    </div>`;
  }).join("");
}

/**
 * Render palet pemilih ikon & warna di form Utang (elemen
 * `#debt-icon-palette` & `#debt-color-palette`) -- mirror utk debt dari
 * renderGoalIconColorPalette, dgn aksen ring rose.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{icon: string, bg: string, color: string}} ctx.formState - debtFormState di index.html (dibaca, tidak di-mutasi).
 */
export function renderDebtIconColorPalette({ document, formState }) {
  const iconWrap = document.getElementById("debt-icon-palette");
  iconWrap.innerHTML = debtIconPalette.map(ic => `
        <button type="button" onclick="pickDebtIcon('${ic}')" class="w-full aspect-square rounded-xl flex items-center justify-center transition ${ic === formState.icon ? formState.bg + " " + formState.color + " ring-2 ring-offset-1 ring-rose-400" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}">
            <i class="fas ${ic} text-sm"></i>
        </button>`).join("");
  const colorWrap = document.getElementById("debt-color-palette");
  colorWrap.innerHTML = debtColorPalette.map(c => `
        <button type="button" onclick="pickDebtColor('${c.bg}','${c.color}')" class="w-8 h-8 rounded-full ${c.bg} flex items-center justify-center transition ${c.bg === formState.bg ? "ring-2 ring-offset-1 ring-rose-400" : ""}">
            ${c.bg === formState.bg ? `<i class="fas fa-check text-[10px] ${c.color}"></i>` : ""}
        </button>`).join("");
}

/**
 * Render daftar kartu Utang & Cicilan (elemen `#debts-list-container`):
 * progres pelunasan + bar, sisa utang, estimasi bulan lagi, tombol bayar
 * cicilan / status Lunas. Perhitungan progres satu sumber kebenaran di
 * src/domain/goals-debts.js (computeDebtProgress, via servicesModule).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {{debts?: Array<object>}} ctx.appSettings - settings global (dibaca .debts).
 * @param {(debt: object) => {paidPct: number, sisa: number, isLunas: boolean, bulanLagi: number|null}} ctx.computeDebtProgress -
 *   dari src/domain/goals-debts.js (via servicesModule).
 * @param {(str: string) => string} ctx.escapeHtml
 */
export function renderDebtsList({ document, appSettings, computeDebtProgress, escapeHtml }) {
  const listEl = document.getElementById("debts-list-container"); if (!listEl) return;
  const debts = appSettings.debts || [];
  if (debts.length === 0) {
    listEl.innerHTML = `
        <div class="col-span-1 md:col-span-2 py-12 text-center text-slate-400 stagger-item">
            <i class="fas fa-hand-holding-dollar text-4xl mb-3 opacity-30"></i>
            <p class="text-sm font-bold text-slate-500">Belum ada utang/cicilan tercatat</p>
            <p class="text-[10px]">Bikin catatan pertamamu lewat tombol Tambah Utang.</p>
        </div>`;
    return;
  }
  listEl.innerHTML = debts.map(d => {
    // Progres pelunasan (persen, sisa, status lunas, estimasi bulan lagi): satu sumber
    // kebenaran sekarang src/domain/goals-debts.js (computeDebtProgress).
    const { paidPct, sisa, isLunas, bulanLagi } = computeDebtProgress(d);
    let estimasiHtml = "";
    if (bulanLagi !== null) {
      estimasiHtml = `<span class="text-[10px] text-slate-400 flex items-center gap-1"><i class="fas fa-hourglass-half"></i> ~${bulanLagi} bulan lagi (estimasi)</span>`;
    }
    return `
    <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm stagger-item">
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center min-w-0">
                <div class="w-10 h-10 rounded-xl ${d.bg} ${d.color} flex items-center justify-center mr-3 flex-shrink-0"><i class="fas ${d.icon}"></i></div>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(d.nama)}</p>
                    ${estimasiHtml}
                </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <button onclick="openDebtModal(true,'${d.id}')" aria-label="Ubah utang" class="w-7 h-7 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-pencil text-[10px]"></i></button>
                <button onclick="removeDebt('${d.id}')" aria-label="Hapus utang" class="w-7 h-7 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-trash text-[10px]"></i></button>
            </div>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
            <div class="h-full rounded-full ${isLunas ? "bg-emerald-400" : "bg-rose-400"} transition-all" style="width:${paidPct}%"></div>
        </div>
        <div class="flex items-center justify-between mb-3">
            <span class="text-[11px] font-bold ${isLunas ? "text-emerald-500" : "text-slate-500"}">${paidPct}% terlunasi</span>
            <span class="text-[10px] text-slate-400">sisa Rp ${new Intl.NumberFormat("id-ID").format(sisa)}</span>
        </div>
        ${isLunas
            ? `<div class="w-full bg-emerald-50 text-emerald-600 text-center text-xs font-bold py-2.5 rounded-xl"><i class="fas fa-circle-check mr-1.5"></i>Lunas!</div>`
            : `<button onclick="openDebtPayModal('${d.id}')" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2.5 rounded-xl transition active:scale-95">+ Bayar Cicilan</button>`}
    </div>`;
  }).join("");
}
