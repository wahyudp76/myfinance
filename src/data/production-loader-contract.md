# Production Initial Data Loader Contract

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
