/**
 * Pure builder skeleton (slice design #3). Mengembalikan string HTML blok
 * skeleton Dashboard -- meniru struktur konten aslinya (kartu ringkasan x3,
 * chart + kartu samping, daftar transaksi) supaya saat sinkronisasi data
 * app terasa "hidup", bukan layar blur kosong. Tanpa DOM/data apa pun --
 * deterministik penuh, diuji unit; container & animasi diurus index.html +
 * styles.css (.skeleton-bone, hormat prefers-reduced-motion).
 */
export function dashboardSkeletonHtml() {
  const card = (inner) => `<div class="bg-white rounded-3xl border border-slate-100 p-5">${inner}</div>`;
  const summaryCard = card(`
        <div class="flex items-center justify-between mb-3">
            <div class="skeleton-bone h-10 w-10 rounded-2xl"></div>
            <div class="skeleton-bone h-3 w-10 rounded"></div>
        </div>
        <div class="skeleton-bone h-7 w-3/4 rounded-lg mb-2"></div>
        <div class="skeleton-bone h-3 w-1/2 rounded"></div>`);
  const listRow = `
        <div class="flex items-center gap-3 mb-3">
            <div class="skeleton-bone h-9 w-9 rounded-full flex-shrink-0"></div>
            <div class="flex-1 space-y-1.5">
                <div class="skeleton-bone h-3.5 w-2/3 rounded"></div>
                <div class="skeleton-bone h-2.5 w-1/3 rounded"></div>
            </div>
            <div class="skeleton-bone h-3.5 w-16 rounded flex-shrink-0"></div>
        </div>`;
  return `
<div class="max-w-6xl mx-auto" aria-hidden="true">
    <div class="flex items-end justify-between mb-6 md:mb-8">
        <div class="space-y-2">
            <div class="skeleton-bone h-7 w-44 rounded-lg"></div>
            <div class="skeleton-bone h-3.5 w-28 rounded"></div>
        </div>
        <div class="skeleton-bone h-8 w-24 rounded-full"></div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">${summaryCard}${summaryCard}${summaryCard}</div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 mb-4">
        ${card(`<div class="skeleton-bone h-3.5 w-32 rounded mb-4"></div><div class="skeleton-bone h-44 w-full rounded-2xl"></div>`)}
        ${card(`<div class="skeleton-bone h-3.5 w-24 rounded mb-4"></div>
        <div class="skeleton-bone h-4 w-full rounded mb-2.5"></div>
        <div class="skeleton-bone h-4 w-5/6 rounded mb-2.5"></div>
        <div class="skeleton-bone h-4 w-4/6 rounded mb-2.5"></div>
        <div class="skeleton-bone h-4 w-2/3 rounded"></div>`)}
    </div>
    ${card(`<div class="skeleton-bone h-3.5 w-40 rounded mb-4"></div>${listRow.repeat(5)}`)}
</div>`.trim();
}
