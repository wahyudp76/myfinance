# MyFinance Reliability Release Checklist

## Current state

This release is **NOT READY TO MIGRATE** yet.

The database migrations are intentionally separate from production execution. No SQL in this repository is executed merely by committing it to GitHub.

## Required application changes before migration

- [ ] Recurring browser processor calls `create_recurring_transaction()`.
- [ ] Recurring `next_due_date` advances only after a successful RPC call.
- [ ] Budget save calls `replace_month_budgets()`.
- [ ] Transfer form calls `create_transfer_transaction()` for all new transfers.
- [ ] Transfer destination balance uses `transfer_jumlah_tujuan` when present.
- [ ] Cross-currency preview shows source amount, target amount, currencies and rate.
- [ ] Historical transfers remain readable when target fields are NULL.
- [ ] Analyze-finance Edge Function is deployed with `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] AI rate-limit client-write policy is removed only after the Edge Function deployment.

## Database preflight

Run `sql/pre_migration_checks_2026-08.sql` first.

Do not proceed if:

- historical recurring duplicate diagnostics return conflicting rows;
- impossible monetary metadata is found;
- unexpected budget duplicates exist;
- recurring templates have invalid dates.

## Functional regression matrix

| Scenario | Expected |
|---|---|
| IDR -> IDR transfer | destination amount equals source amount |
| USD -> USD transfer | destination amount equals source amount |
| USD -> IDR transfer | target = source × source-IDR-rate / target-IDR-rate |
| IDR -> USD transfer | target = source × 1 / USD-IDR-rate |
| repeated recurring processing | one transaction per template/date |
| recurring RPC failure | next_due_date does not advance |
| budget insert failure | previous month budget remains intact |
| AI chat within 8 seconds | 429 response |
| AI Gemini failure | rate-limit timestamp is not advanced |

## Migration order

1. Backup/export production data.
2. Run pre-migration diagnostics.
3. Deploy the matching Edge Function.
4. Deploy the matching frontend release.
5. Run reliability + transfer migrations.
6. Run AI rate-limit migration.
7. Execute the regression matrix.
8. Monitor errors and transaction counts.

## Rollback principle

Do not delete historical transaction rows as part of rollback. Roll back application deployment first. Database columns added by these migrations are additive and can remain in place while the application is reverted, provided the application tolerates NULL values.
