# MyFinance — Current Data Flow Map

> **⚠️ DOKUMEN HISTORIS — SUDAH TIDAK BERLAKU (catatan 2026-09-12).**
> Ini snapshot fase *discovery* awal, ditulis saat alat pencari kode hanya melihat
> `index.html` yang terpotong. Hampir seluruh kesimpulan "not confirmed" di bawah
> **sudah terbantahkan**:
> - `createClient(...)` **ADA** — `src/services/supabase/client.js`, memakai bundel
>   ter-pin `vendor/supabase-js-2.113.0.bundle.min.mjs` (bukan CDN).
> - `SUPABASE_URL` + `SUPABASE_ANON_KEY` **ADA** — di `app.src.js` bawah komentar
>   "KONEKSI SUPABASE" (bukan di `index.html`; ikut pindah saat blok monolit
>   diekstrak di v54).
> - "Inline HTML/CSS/JavaScript + CDN libraries" **sudah tidak benar**: CSS dipisah ke
>   `styles.css` + `css/tailwind.css` (build statis), JS monolit ke `app.js`, wiring
>   modul ke `boot.bundle.js`, dan **nol CDN** di jalur kritis sejak v59 (semua
>   di-vendor ke `vendor/`).
> - "Browser → PostgreSQL directly: not confirmed" → **terkonfirmasi**: itulah satu-satunya
>   jalur data, lewat PostgREST + RLS (11 tabel) dan 4 RPC.
> - `google.script.run` sudah lama hilang; adapter penggantinya (`api.run`) juga sudah
>   **pensiun utuh** (seri commit `refactor(api-seam)`).
> - Satu-satunya yang masih benar: preferensi tema memang di `localStorage`
>   (`myfinance-theme`) dan itu **sengaja** per-perangkat, bukan data keuangan.
>
> **Sumber kebenaran terbaru:** [`STRUKTUR-REPO.md`](../STRUKTUR-REPO.md) §3 (Alur Muat)
> dan §4 (Alur Data), plus [`AGENT-HANDOFF.md`](../AGENT-HANDOFF.md) untuk riwayat per versi.
> Isi di bawah dipertahankan apa adanya sebagai catatan proses, bukan sebagai peta terkini.

> This document describes what can be established from the repository code currently visible in GitHub. It intentionally distinguishes **confirmed** paths from **not yet confirmed** paths.

## 1. Confirmed runtime entry point

```text
Browser
  ↓
GitHub Pages / index.html
  ↓
Inline HTML/CSS/JavaScript + CDN libraries
```

`index.html` is still the main frontend entry point. It contains theme initialization, PWA metadata, Tailwind CDN, Chart.js, DataLabels, Font Awesome, and the application runtime.

## 2. Confirmed browser-local state

The theme preference is stored in browser `localStorage` under `myfinance-theme`.

```text
UI theme setting
   ↓
localStorage
   ↓
HTML <html class="dark">
```

This is intentionally device-local and is not financial account data.

## 3. Backend/data path — currently NOT confirmed in main

Repository searches on the current main branch did not expose a direct:
- `createClient(...)` Supabase browser client
- `SUPABASE_URL` configuration
- `google.script.run`
- obvious `fetch(...)` API call
- obvious `localStorage` financial-data persistence

Therefore the exact production persistence path for financial data is **not yet proven from the current indexed source**.

## 4. Repository backend assets that exist

The repository contains Supabase SQL and Edge Function assets, including `supabase/functions/analyze-finance/index.ts` and SQL migrations. These prove that Supabase is part of the project architecture, but do not by themselves prove that the deployed `index.html` currently calls Supabase directly.

```text
Repository
 ├── index.html                → confirmed frontend entry
 ├── sql/schema.sql            → database contract
 ├── sql/migrations             → database evolution
 └── supabase/functions/...    → server-side/Edge Function code
```

## 5. Current architecture confidence

| Path | Status | Confidence |
|---|---|---|
| Browser → index.html | Confirmed | High |
| Theme → localStorage | Confirmed | High |
| Browser → Supabase client | Not found in indexed main source | High |
| Browser → Google Apps Script | Not found in indexed main source | High |
| Browser → custom REST API | Not found in indexed main source | Medium |
| Supabase Edge Function → external AI | Repository asset exists | High |
| Browser → PostgreSQL directly | Not confirmed | High |

## 6. Important conclusion

The correct next engineering step is **not** to migrate UI calls blindly. We first need to identify the actual deployed data endpoint/configuration or any dynamically generated/connector-managed code that is not represented in the searchable main source.

Once the actual persistence path is identified, the target migration can be mapped safely:

```text
CURRENT (to be fully verified)
Browser → existing data endpoint → storage/backend

TARGET
Browser → Supabase Auth → RLS/RPC → PostgreSQL
                         ↘ Edge Functions for privileged operations
```

## 7. Release safety rule

No production migration should be requested until the current persistence path is positively identified and a read/write parity test is defined.
