# MyFinance — Supabase-Native Migration Plan

> **STATUS 2026-09-12 — Goal TERCAPAI; Phase 1–6 selesai, Phase 7 selesai sebagian.**
>
> - **Goal** ("remove the legacy `api.run.*` data layer") ✅ — adapter dipensiunkan utuh
>   (seri commit `refactor(api-seam)`). Supabase kini satu-satunya sumber kebenaran; yang
>   tersisa di `app.src.js` hanya teks label `console.error` & komentar riwayat.
> - **Keenam Rules** masih ditegakkan: (5) browser hanya memegang anon key — service-role
>   hanya di Edge Function; (6) RLS aktif di 11 tabel, dan `anon` di-revoke dari semua RPC.
> - **Phase 1** ✅ `docs/financial-invariants.md` + `docs/schema-contract-audit.md` ·
>   **Phase 2** ✅ `create_transfer_transaction` + 4 kolom sisi tujuan ·
>   **Phase 3** ✅ `create_recurring_transaction` idempoten (unique index
>   `transactions_recurring_idempotency_idx`, `next_due_date` maju hanya setelah sukses) ·
>   **Phase 4** ✅ `replace_month_budgets` atomik · **Phase 5** ✅ settings/custom_icons/
>   assets/debts di `src/services/supabase/*` + `src/domain/account-currency.js` ·
>   **Phase 6** ✅ rate limiting pindah server (RPC `check_and_consume_rate_limit` +
>   `api_rate_limits`), otorisasi Edge Function diaudit
>   (`docs/rls-grants-audit-2026-08-31.md`).
> - **Phase 7** ⚠️ SEBAGIAN: `api.run.*` & kode sinkronisasi mati sudah hilang, dan
>   "split the monolithic frontend into maintainable modules" sudah menghasilkan 72 modul ES
>   di `src/` (domain 38 · ui 12 · services 14 · auth 5 · bootstrap 2) — seluruh helper
>   *murni* sudah habis dipindah (`docs/PILOT-MIGRASI-v71.md` = SELESAI). Tapi `app.src.js`
>   masih ±8.560 baris / ±394 fungsi karena sisanya DOM-bound. **Catatan:** `src/bootstrap/`
>   dan `src/auth/lifecycle.js` hasil phase ini BELUM ter-wire ke produksi (lihat
>   `docs/production-loader-contract.md`).
>
> **Release gate — semua terpenuhi, dan kini ditegakkan mesin (bukan dicek manual):**
>
> | Gate | Bukti otomatis |
> |---|---|
> | Transfer IDR→IDR / USD→USD / USD→IDR / IDR→USD terverifikasi | `schema-verify/functional-check.sql` CEK 3a+3b (USD 100 @16.000 → `jumlah_idr` **dan** `transfer_jumlah_tujuan` = 1.600.000) di Postgres nyata; `tests/unit/finance-domain.test.js` utk USD→IDR & IDR→USD. *Sisa kecil:* pasangan same-currency (rate 1) hanya terjamin lewat rumus `S × Rs / Rd`, belum punya kasus uji eksplisit di level DB. |
> | Transfer dikecualikan dari total pemasukan/pengeluaran | `isCashflowTransaction()` (`src/domain/finance.js`) + test-nya; `computeAccountGroupNet`/`buildAccountBalanceSeries` (`src/domain/accounts.js`) |
> | Recurring retry idempoten | CEK 4a+4b (dipanggil 2× → id sama, tetap 1 baris) + unique index |
> | Budget save atomik | CEK 2+2b (replace, bukan menumpuk) |
> | RLS terverifikasi untuk user kedua | CEK 1a+1b & 5c & 6 (Postgres nyata) + `tests/parity/live-isolation-parity.mjs` (live, opt-in) + audit behavioral 3 konteks kredensial |
> | Data historis tetap ter-render sama | `tests/parity/*` (legacy vs native) + `src/services/parity/transactions.js` |
> | Prosedur backup & rollback terdokumentasi | `src/domain/backup.js` (build/validate/restore) + fitur "Ekspor Backup"/"Pilih Berkas Backup" di Pengaturan; preflight `sql/migrations/pre_migration_checks_2026-08.sql` |
>
> Gate 1–5 berjalan otomatis di CI (job `Schema install check (Postgres)`, hermetic, tiap
> push/PR). Peta terkini: [`STRUKTUR-REPO.md`](../STRUKTUR-REPO.md).

## Goal
Remove the legacy `api.run.*` data layer and make Supabase the single source of truth for application data, while preserving existing user data and behavior.

## Rules
1. No production SQL migration until application code using the new schema/RPCs is ready.
2. Existing historical transactions must remain readable.
3. New writes must have one authoritative path.
4. Financial operations that span multiple rows must be atomic.
5. Browser code may use the Supabase anon key only; privileged secrets stay in Edge Functions.
6. RLS remains enabled for all user-owned tables.

## Target architecture

Browser UI → Supabase Auth → Supabase Postgres/RLS
                         ↘ RPCs for atomic financial writes
                          ↘ Edge Functions for privileged/external operations

## Migration order

### Phase 1 — Foundation
- Document data ownership and API contracts.
- Introduce a small frontend Supabase service layer.
- Keep UI behavior unchanged.
- Add tests for financial calculations.

### Phase 2 — Transactions
- Replace legacy transaction reads/writes.
- Add atomic transfer RPC.
- Store native amount + IDR snapshot + destination amount for cross-currency transfers.
- Preserve legacy rows.

### Phase 3 — Recurring
- Move due-date processing to an idempotent database operation.
- Advance `next_due_date` only after successful transaction creation.

### Phase 4 — Budgets
- Replace delete/insert saves with an atomic replacement RPC.

### Phase 5 — Accounts/settings/assets/debts
- Move remaining CRUD paths to Supabase services.
- Normalize account currency handling.

### Phase 6 — AI/security
- Move rate limiting and privileged writes fully server-side.
- Verify Edge Function authorization and secret handling.

### Phase 7 — Remove legacy layer
- Remove unused `api.run.*` calls and compatibility adapters.
- Remove dead synchronization code.
- Split the monolithic frontend into maintainable modules after behavior is stable.

## Release gate
A migration is not production-ready until:
- IDR→IDR, USD→USD, USD→IDR and IDR→USD transfers are verified.
- Transfer is excluded from income/expense totals.
- Recurring retries are idempotent.
- Budget save is atomic.
- RLS is verified for a second user.
- Existing historical data renders unchanged.
- Backup and rollback procedures are documented.
