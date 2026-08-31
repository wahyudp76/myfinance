// Verifikasi migrasi Tailwind build-statis (jalankan dengan server statis aktif).
// Cek: tidak ada CDN, stylesheet termuat, sentinel utility ter-hit (computed),
// dark mode, palet kategori, geometri responsif 1280/375 via section statis.
import { chromium } from 'playwright';

const BASE = process.env.MYFINANCE_APP_URL || 'http://localhost:8123';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const consoleMsgs = [];
const pageErrors = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => pageErrors.push(String(e)));

// Blokir supabase: cukup untuk shell statis + login (tanpa kredensial apapun).
await page.route('**supabase.co/**', (r) => r.abort());
await page.route('**supabase.in/**', (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// 1. CDN hilang, stylesheet build termuat
const cdnScript = await page.locator('script[src*="cdn.tailwindcss.com"]').count();
ok('1. script CDN tailwind HILANG dari head', cdnScript === 0, `count=${cdnScript}`);
const cdnPreconnect = await page.locator('link[rel=preconnect][href*="tailwindcss"]').count();
ok('1b. preconnect CDN hilang', cdnPreconnect === 0, `count=${cdnPreconnect}`);
const cssInfo = await page.evaluate(() => {
  const l = [...document.querySelectorAll('link[rel=stylesheet]')].find((x) =>
    x.href.includes('css/tailwind.css')
  );
  if (!l) return { found: false };
  let n = 0, okRules = true;
  try { n = l.sheet.cssRules.length; } catch { okRules = false; }
  const stylesIdx = [...document.querySelectorAll('link[rel=stylesheet]')].findIndex(
    (x) => x.href.includes('styles.css')
  );
  const twIdx = [...document.querySelectorAll('link[rel=stylesheet]')].findIndex(
    (x) => x.href.includes('css/tailwind.css')
  );
  return { found: true, n, okRules, twIdx, stylesIdx };
});
ok('2. css/tailwind.css termuat + ter-parse', cssInfo.found && cssInfo.okRules && cssInfo.n > 400, JSON.stringify(cssInfo));
ok('3. urutan: tailwind.css SEBELUM styles.css', cssInfo.twIdx !== -1 && cssInfo.stylesIdx !== -1 && cssInfo.twIdx < cssInfo.stylesIdx, `tw=${cssInfo.twIdx} styles=${cssInfo.stylesIdx}`);

// 2. Tidak ada warning tailwind runtime, tidak ada pageerror
const twWarn = consoleMsgs.filter((m) => /tailwind/i.test(m)).length;
ok('4. console bebas pesan tailwind (warning Play CDN)', twWarn === 0, consoleMsgs.filter(m=>/tailwind/i.test(m)).slice(0,2).join(' | '));
ok('5. 0 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

// 3. Sentinel utility via computed style (login screen terlihat)
const loginVisible = await page.locator('.login-card, [class*=login]').first().isVisible().catch(() => false);
ok('6. halaman login ter-render (shell hidup)', loginVisible);
const sent = await page.evaluate(() => {
  const pick = (sel) => document.querySelector(sel);
  const r3 = pick('.rounded-3xl');
  const t10 = pick('.text-\\[10px\\]');
  const body = getComputedStyle(document.body);
  return {
    rounded: r3 ? getComputedStyle(r3).borderTopLeftRadius : 'no-el',
    t10: t10 ? getComputedStyle(t10).fontSize : 'no-el',
    font: body.fontFamily.slice(0, 40),
    bodyBg: body.backgroundColor,
    sheetHasViolet: [...document.styleSheets].some((s) => {
      try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.includes('bg-violet-100')); }
      catch { return false; }
    }),
  };
});
ok('7. .rounded-3xl -> 24px', sent.rounded === '24px', sent.rounded);
ok('8. .text-[10px] -> 10px', sent.t10 === '10px', sent.t10);
ok('9. font body Plus Jakarta Sans', /Plus Jakarta Sans/.test(sent.font), sent.font);

// 4. Palet kategori (bg-violet-100) tersedia di cascade
ok('10. rule bg-violet-100 ada di stylesheet', sent.sheetHasViolet);

// 5. Dark mode: class dark di <html> -> rule .dark styles.css jalan
const darkTest = await page.evaluate(() => {
  // sistem dark = override stacking ".dark .bg-white" (styles.css) di atas utility tailwind
  const el = document.querySelector('.bg-white');
  if (!el) return { changed: false, before: 'no-el', after: '' };
  const before = getComputedStyle(el).backgroundColor;
  document.documentElement.classList.add('dark');
  const after = getComputedStyle(el).backgroundColor;
  document.documentElement.classList.remove('dark');
  return { before, after, changed: before !== after && after === 'rgb(30, 41, 59)' };
});
ok('11. toggle .dark: .bg-white -> #1e293b (slate-800)', darkTest.changed, `${darkTest.before} -> ${darkTest.after}`);

// 6. Geometri responsif pada section statis (un-hide -> ukur -> restore)
async function measure(viewport, sectionSel, probeSel, prop) {
  await page.setViewportSize(viewport);
  return page.evaluate(({ sectionSel, probeSel, prop }) => {
    const sec = document.querySelector(sectionSel);
    if (!sec) return 'no-section';
    const prev = sec.style.display;
    const prevClass = sec.className;
    sec.style.display = 'block';
    sec.style.visibility = 'hidden';
    const el = sec.querySelector(probeSel) || document.querySelector(probeSel);
    if (!el) { sec.style.display = prev; return 'no-probe'; }
    const v = getComputedStyle(el)[prop];
    sec.style.display = prev; sec.className = prevClass;
    return v;
  }, { sectionSel, probeSel, prop });
}
const grid4 = await measure({ width: 1280, height: 900 }, '#view-dashboard', '#dashboard-accounts-container', 'gridTemplateColumns');
ok('12. dashboard accounts 4 kolom @1280', /repeat\(4/.test(grid4), grid4);
const grid375 = await measure({ width: 375, height: 800 }, '#view-dashboard', '#dashboard-accounts-container', 'gridTemplateColumns');
ok('13. dashboard accounts 2 kolom @375', /repeat\(2/.test(grid375), grid375);

// budget wrapper lg:grid-cols-2 @1280
const budgetCols = await measure({ width: 1280, height: 900 }, '#view-budget', '#view-budget .lg\\:grid-cols-2', 'gridTemplateColumns');
ok('14. budget 2 kolom @1280 (chart+perincian)', /repeat\(2/.test(budgetCols), budgetCols);

// 7. FullCalendar: styles .fc-* tetap ada (styles.css)
const fcOk = await page.evaluate(() =>
  [...document.styleSheets].some((s) => {
    try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.startsWith('.fc')); }
    catch { return false; }
  })
);
ok('15. rule .fc-* FullCalendar tetap ada', fcOk);

// 8. Permintaan jaringan: tidak ada yang keluar ke cdn.tailwindcss.com
const cdnReqs = [];
page.on('request', (r) => { if (r.url().includes('cdn.tailwindcss.com')) cdnReqs.push(r.url()); });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
ok('16. 0 request ke cdn.tailwindcss.com setelah reload', cdnReqs.length === 0, cdnReqs.join(','));
const errAfter = pageErrors.length;
ok('17. 0 pageerror setelah reload', errAfter === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const fails = results.filter((r) => !r.pass).length;
console.log(`\n===== ${results.length - fails}/${results.length} PASS =====`);
process.exit(fails ? 1 : 0);
