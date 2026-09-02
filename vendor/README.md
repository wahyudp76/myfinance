# vendor/ — dependensi JS pihak ketiga yang di-self-host (v59, 2026-09-02)

Sebelum v59, app memuat pustaka pihak ketiga dari CDN lintas-origin di jalur
kritis: `https://esm.sh/@supabase/supabase-js@2` (**floating** — versi bisa
berubah diam-diam) dan `https://cdn.jsdelivr.net/npm/chart.js` (**TANPA versi** —
jsdelivr boleh menyajikan major baru kapan saja). Mulai v59 SEMUANYA vendored
lokal di folder ini, **pinned ke versi eksak**, sehingga:

1. **Nol origin script pihak ketiga** di jalur kritis → CSP `script-src`
   cukup `'self' 'unsafe-inline'` (jsdelivr & esm.sh dihapus dari index.html
   meta CSP + `_headers`), tidak ada preconnect DNS/TLS tambahan.
2. **Versi terpin** → perilaku app tidak berubah tanpa perubahan yang
   disengaja + ter-review.
3. **Lebih cepat**: rantai 7 request esm.sh (stub → sub-modul es2022, sebagian
   unminified) diganti 1 bundel minified + polyfill kecil, same-origin, bisa
   di-precache SW.

## Isi folder

| File | Pustaka | Versi (PIN) | Asal (diunduh 2026-09-02) |
|---|---|---|---|
| `supabase-js-2.113.0.bundle.min.mjs` | @supabase/supabase-js (ESM bundel) | 2.113.0 | `https://esm.sh/@supabase/supabase-js@2.113.0/es2022/supabase-js.bundle.mjs` |
| `esm-node-process.mjs` | polyfill `node:process` (dibutuhkan bundel) | — | `https://esm.sh/node/process.mjs` |
| `esm-node-buffer.mjs` | polyfill `node:buffer` | — | `https://esm.sh/node/buffer.mjs` |
| `esm-node-events.mjs` | polyfill `node:events` (dibutuhkan process) | — | `https://esm.sh/node/events.mjs` |
| `esm-node-tty.mjs` | polyfill `node:tty` (dibutuhkan process) | — | `https://esm.sh/node/tty.mjs` |
| `esm-node-async_hooks.mjs` | polyfill `node:async_hooks` (dibutuhkan events) | — | `https://esm.sh/node/async_hooks.mjs` |
| `chartjs-4.5.1.min.js` | Chart.js (UMD minified) | 4.5.1 | `https://cdn.jsdelivr.net/npm/chart.js@4.5.1` |
| `chartjs-plugin-datalabels-2.0.0.min.js` | chartjs-plugin-datalabels | 2.0.0 | `https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0` |
| `fullcalendar-6.1.10.min.js` | FullCalendar global build | 6.1.10 | `https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js` |

## Prosedur pembuatan / upgrade (reproducible)

Pemakaian di app: `src/services/supabase/client.js` mengimpor
`../../vendor/supabase-js-2.113.0.bundle.min.mjs`; loader chart di `index.html`
dan `loadFullCalendarLib()` di `app.src.js` menyuntik `./vendor/*.js` via
`<script>` dinamis; `sw.js` mem-precache semuanya.

Langkah mengganti versi supabase-js (mis. ke 2.x.y):

1. Unduh bundel + polyfill: `curl -sL https://esm.sh/@supabase/supabase-js@2.x.y/es2022/supabase-js.bundle.mjs`
2. Telusuri **seluruh** rantai `import "/node/....mjs"` (esm.sh memakai path
   ABSOLUT `/node/...`). Unduh tiap polyfill, tulis ulang path-nya jadi
   **relatif** `./esm-node-*.mjs` di SEMUA file yang mengimpornya (bundel →
   process/buffer; process → events/tty; events → async_hooks; dst sampai
   rantainya tertutup — cek: `grep -h -o 'from"[^"]*"' vendor/*.mjs | sort -u`
   tidak boleh ada yang bukan `./esm-node-*`).
3. Minify tiap file `.mjs` dengan terser (devDependency):
   `npx terser <in>.mjs --module --compress passes=2 --mangle -o <out>.mjs`
4. Ganti nama file agar memuat versi baru (`supabase-js-2.x.y.bundle.min.mjs`),
   update import di `src/services/supabase/client.js`, precache di `sw.js`,
   bump `CACHE_VERSION`, regen snapshot (`scripts/sw/regen-snapshot.mjs` — cek
   nama script via `npm run`), lalu update tabel di file ini.
5. Verifikasi fungsional (WAJIB): `npm run test:unit`, E2E `verify-hud`
   (login+data+chart lewat modul asli), dan Lighthouse (nol pelanggaran CSP).
   Tes cepat di Node: import modul lalu `createClient(url, key)` —
   (perlu stub `globalThis.WebSocket` karena Node 20 tanpa WebSocket global;
   browser asli tidak membutuhkannya.)

Chart.js / datalabels / FullCalendar: unduh versi PERSIS dari jsdelivr dengan
nomor versi eksak, ganti nama file memuat versi, update loader (index.html /
app.src.js), sw.js precache, CACHE_VERSION, tabel di atas.

## Catatan

- Polyfill `esm-node-*` tidak berversi (nama file stabil) karena isinya
  mengikuti bundel supabase-js yang mengimpornya; saat upgrade, unduh ulang
  semuanya dari esm.sh dan biarkan path relatif menjamin konsistensi.
- Jangan menambahkan pustaka baru tanpa memin+men-document-kan di sini dan
  tanpa memastikan CSP (`index.html` meta + `_headers`) serta precache
  `sw.js` tetap sinkron.
