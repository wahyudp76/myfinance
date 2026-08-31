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
  const syncLogo = `<svg class="mf-sync-logo w-10 h-10 flex-shrink-0" aria-hidden="true" focusable="false" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"> <defs> <linearGradient id="lgS-bodyGrad" x1="20%" y1="0%" x2="75%" y2="100%"> <stop offset="0%" stop-color="#8d8af3"/> <stop offset="45%" stop-color="#6c4ee4"/> <stop offset="100%" stop-color="#6a3de0"/> </linearGradient> <linearGradient id="lgS-coinGrad" x1="0%" y1="0%" x2="100%" y2="100%"> <stop offset="0%" stop-color="#f9d68a"/> <stop offset="100%" stop-color="#e8a93a"/> </linearGradient> <clipPath id="lgS-bodyClip"> <rect x="0" y="0" class="mf-sync-logo w-10 h-10 flex-shrink-0" aria-hidden="true" focusable="false" rx="112"/> </clipPath> </defs> <rect x="0" y="0" class="mf-sync-logo w-10 h-10 flex-shrink-0" aria-hidden="true" focusable="false" rx="112" fill="url(#lgS-bodyGrad)"/> <g clip-path="url(#lgS-bodyClip)"> <path d="M0,120 Q256,168 512,120 V0 H0 Z" fill="#ffffff" opacity="0.15"/> </g> <circle cx="196" cy="292" r="34" fill="#211c3a"/> <circle cx="316" cy="292" r="34" fill="#211c3a"/> <circle cx="184" cy="280" r="9" fill="#ffffff"/> <circle cx="304" cy="280" r="9" fill="#ffffff"/> <circle cx="138" cy="316" r="24" fill="#b06fce" opacity="0.85"/> <circle cx="374" cy="316" r="24" fill="#b06fce" opacity="0.85"/> <path d="M182 340 Q256 384 330 340" stroke="#211c3a" stroke-width="16" stroke-linecap="round" fill="none"/> <circle cx="382" cy="118" r="60" fill="#ffffff"/> <circle cx="382" cy="118" r="48" fill="url(#lgS-coinGrad)"/> <text x="382" y="134" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#8a5a12" text-anchor="middle">Rp</text> </svg>`;
  return `
<div class="max-w-6xl mx-auto" aria-hidden="true">
    <div class="flex items-center gap-3 mb-6 md:mb-8">
        ${syncLogo}
        <div>
            <p class="text-sm font-bold text-slate-500 animate-pulse">Menyinkronkan data&#8230;</p>
            <p class="text-xs text-slate-400 mt-0.5">Sebentar ya, sedang memuat kabar keuanganmu</p>
        </div>
    </div>
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
