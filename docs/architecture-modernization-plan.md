# MyFinance — Supabase-native modernization plan

> **STATUS 2026-09-12 — rencana ini pada dasarnya SUDAH dijalankan; bagian "Current state"
> di bawah sudah tidak menggambarkan repo.**
>
> - *"`index.html` contains the application UI, CSS, and most client-side logic"* → CSS sudah
>   dipisah (`styles.src.css` → `styles.css`, `css/tailwind.src.css` → `css/tailwind.css`);
>   logika monolit sudah diekstrak byte-exact ke `app.src.js` → `app.js` (v54/v55); wiring
>   modul ke `boot.js` → `boot.bundle.js` (v98/v103). `index.html` kini tinggal markup
>   (9 view + 19 modal) + 4 blok `<script>` inline kecil yang di-hash CSP.
> - *"Some legacy `api.run.*` references remain"* → adapter `api.run` **pensiun utuh**
>   (seri commit `refactor(api-seam)`). Yang tersisa di `app.src.js` hanya teks label
>   `console.error('api.run.<nama> gagal:')` dan komentar riwayat — bukan pemanggilan.
> - **Phase 1 (Discovery)** ✅ · **Phase 2 (Financial correctness)** ✅ (3 RPC atomik +
>   `docs/financial-invariants.md` diuji `scripts/schema-verify/functional-check.sql`) ·
>   **Phase 3 (Application migration)** ✅ (service layer `src/services/**` satu-satunya
>   boundary DB) · **Phase 4 (Refactoring)** ⚠️ SEBAGIAN — 72 modul ES di `src/`
>   (domain 38 / ui 12 / services 14 / auth 5 / bootstrap 2), tapi `app.src.js` masih
>   ±8.560 baris dengan ±394 fungsi; helper *murni* sudah habis dipindah
>   (`docs/PILOT-MIGRASI-v71.md` berstatus SELESAI), sisanya DOM-bound ·
>   **Phase 5 (Security & ops)** ✅ (RLS + audit grants `docs/rls-grants-audit-2026-08-31.md`,
>   RPC di-revoke dari `anon`, CSP tanpa `unsafe-inline`/`unsafe-eval`, `.gitleaks.toml`,
>   preflight `sql/migrations/pre_migration_checks_2026-08.sql`) ·
>   **Phase 6 (UX/performance)** ✅ berkelanjutan (vendoring v59, bundling v103, echo lokal
>   v52/v119, pull-to-refresh, a11y, Lighthouse jadi pagar CI).
> - **"Deployment rule" masih berlaku dan kini ditegakkan mesin**: job CI
>   `Schema install check (Postgres)` memasang `sql/schema.sql` dari nol di Postgres nyata
>   tiap push/PR, jadi tidak ada lagi migrasi yang dianggap siap hanya karena file-nya ada.
>
> Peta terkini: [`STRUKTUR-REPO.md`](../STRUKTUR-REPO.md).

## Goal

Move MyFinance toward a maintainable Supabase-native architecture without changing or deleting historical financial data during the refactor.

## Current state

- `index.html` contains the application UI, CSS, and most client-side logic.
- Supabase is the intended cloud data layer.
- Some legacy `api.run.*` references remain in the client code and must be treated as migration candidates, not as a production backend assumption.
- Edge Functions are used for server-side AI functionality.

## Target architecture

```text
Browser / PWA
  |
  +-- UI + local view state
  |
  +-- Supabase Auth
  |
  +-- Supabase database (RLS)
  |
  +-- Supabase RPC for atomic financial operations
  |
  +-- Edge Functions for privileged/server-side operations
```

## Non-negotiable financial invariants

1. Transfer is never income or expense.
2. A transfer between different currencies records the source amount and the converted destination amount using a snapshot of the exchange rate at transfer time.
3. Recurring generation is idempotent: one template + due date can create at most one transaction.
4. Recurring `next_due_date` advances only after the generated transaction succeeds.
5. Budget replacement is atomic.
6. Historical transaction values are immutable snapshots; later exchange-rate changes must not rewrite historical IDR values.
7. RLS must prevent cross-user reads/writes.
8. Privileged operations must not expose service-role credentials to the browser.

## Migration strategy

### Phase 1 — Discovery

- Map every remaining legacy `api.run.*` call.
- Identify its current data path and whether it is still reachable from the UI.
- Map every Supabase table, policy, RPC, and Edge Function.
- Establish a feature-by-feature source of truth.

### Phase 2 — Financial correctness

- Implement and test atomic transfer RPC.
- Implement recurring idempotency.
- Implement atomic budget replacement.
- Verify account balance calculations for same-currency and cross-currency transfers.
- Add regression scenarios for historical multi-currency data.

### Phase 3 — Application migration

- Replace legacy client adapters feature by feature with Supabase services/RPC.
- Keep compatibility reads where necessary until the replacement path is verified.
- Remove obsolete legacy calls only after usage is zero and regression checks pass.

### Phase 4 — Refactoring

Break the monolithic client into modules by domain:

- transactions
- transfers
- recurring
- budgets
- accounts/settings
- assets/debts
- dashboard/reports
- authentication
- shared Supabase services
- shared financial utilities

Do not perform this as a single big-bang rewrite.

### Phase 5 — Security and operations

- Review every RLS policy.
- Move privileged writes to Edge Functions/RPC as appropriate.
- Keep service-role keys server-side only.
- Add migration preflight and postflight checks.
- Add a documented rollback procedure.

### Phase 6 — UX/performance

After financial correctness is stable:

- improve transaction entry speed
- improve mobile navigation
- improve loading/error/empty states
- reduce initial JavaScript and CSS cost
- improve PWA behavior
- add accessibility checks

## Deployment rule

No production database migration should be executed solely because a SQL file exists in GitHub. A migration is READY only when the corresponding application code and server-side functions are compatible, the preflight checks pass, and a rollback path is documented.
