# MyFinance — Supabase-Native Migration Plan

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
