# Production Initial Data Loader Contract

> **STATUS 2026-09-12 — kontrak ini SUDAH dipenuhi produksi, tapi bukan oleh `src/bootstrap/`.**
>
> - **`getSyncData()` sudah tidak ada.** Adapter `api.run` dipensiunkan utuh (seri commit
>   `refactor(api-seam)`); body-nya di-inline ke `loadData()` di `app.src.js` sebagai
>   `Promise.all` atas service layer `src/services/**`. Bentuk hasilnya tetap
>   `{ transactions, budgets, assets, settings, customIcons, recurring }`.
> - **Bukan enam grup lagi, tapi TUJUH.** Sejak v86 ada `platformLogos`
>   (`services/supabase/platform-logos.js`, katalog global logo platform aset).
> - **"One full-load operation → validated snapshot → state commit"**: dipenuhi lewat
>   `_loadDataSeq` (v69). Tiap panggilan `loadData()` mengambil nomor urut; saat hasil tiba,
>   hanya panggilan TERAKHIR yang boleh menimpa state, jadi respons basi (fetch
>   tumpang-tindih, atau selesai SETELAH logout) ditolak. `resetAppState()` menaikkan
>   nomornya di setiap jalur logout.
> - **"Must not overwrite newer state" untuk refresh sempit**: dipenuhi v119 lewat
>   `_txFetchInFlight` (saksi fetch berjalan) + `_pendingTxMutations` +
>   `reconcileTxRowsWithPending()` di `src/domain/transactions.js`.
> - **"A failed optional dataset must not silently masquerade as an empty dataset"**:
>   perilaku produksi MEMANG memakai fallback, tapi **tidak diam-diam** — helper `optional()`
>   membungkus 4 grup non-inti (`custom_icons` → `{}`, `settings` → `null`,
>   `recurring_transactions` → `[]`, `platform_logos` → `[]`) dan selalu
>   `console.warn("Data cloud opsional gagal dimuat (<label>); memakai default lokal.")`.
>   Tiga grup inti (transactions, budgets, assets) TIDAK difallback — kegagalannya
>   menggagalkan load dan menampilkan pesan error.
> - **`src/bootstrap/app.js` + `loader.js` (generation counter & de-dup in-flight) BELUM
>   ter-wire ke produksi** dan belum punya unit test: tidak di-import `boot.js`, sehingga
>   di-tree-shake habis dari `boot.bundle.js`. Modularisasi pola yang sama sudah ada di
>   monolit. Jangan mengedit `src/bootstrap/` sambil mengira itu jalur produksi.

This is the refactor boundary for the existing MyFinance loader. It does not replace the production loader yet.

## Confirmed from `main/index.html`

The existing full-load path is documented in the application as loading six data groups through `getSyncData()`:

1. transactions
2. budgets
3. assets
4. icons
5. settings
6. recurring

The resulting application state includes `globalData`, `globalAssets`, `globalRecurring`, and `appSettings`, with budget/icon data feeding additional UI state.

## Required contract

```text
Authenticated session
  -> one full-load operation
  -> validated immutable snapshot
  -> state commit
  -> UI initialization
```

The refactor must preserve the existing behavior while preventing stale responses from committing after a newer authentication/data generation.

## Important constraints

- Do not independently re-query all six datasets after every CRUD operation.
- Transaction and asset refreshes may remain narrow refreshes, but their responses must carry a request generation and must not overwrite newer state.
- A full snapshot must only be committed if its generation is still current.
- A failed optional dataset must not silently masquerade as an empty dataset unless that is the current production behavior and is explicitly preserved.
- No production wiring is performed until the exact existing `getSyncData()` response shape is verified from source.

## Current confidence

- Six-group full-load contract: CONFIRMED by source comments.
- Exact query implementation and response shape: NOT YET CONFIRMED because the large monolithic `index.html` is truncated by the connector response boundary.
- New loader implementation wired into production: NO.
