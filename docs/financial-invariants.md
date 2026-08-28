# MyFinance — Financial Invariants

These rules are the acceptance criteria for the new data layer.

## Transaction semantics
- `Pemasukan` increases the selected account balance.
- `Pengeluaran` decreases the selected account balance.
- `Transfer` moves value between accounts and is never income or expense.
- A transfer between different currencies converts using the stored snapshot rate.
- Historical transactions do not change when today's exchange rate changes.

## Currency
For a source amount `S`, source IDR rate `Rs`, and destination IDR rate `Rd`:

`destination = S × Rs / Rd`

where each rate means IDR per one unit of that currency.

Example:
- USD 100
- USD rate = 16,000 IDR/USD
- IDR rate = 1 IDR/IDR
- destination = IDR 1,600,000

## Recurring
For each `(user_id, recurring_id, due_date)`, at most one generated transaction may exist.
A recurring template's `next_due_date` advances only when generation succeeds.

## Budget
A monthly budget replacement is atomic. A failed replacement must leave the previous budget set intact.

## Security
Every user-owned row is restricted by `auth.uid() = user_id` through RLS. Privileged service-role credentials are never shipped to the browser.

## Migration safety
Existing historical rows remain valid. New columns are nullable/backward-compatible where required for legacy data.
