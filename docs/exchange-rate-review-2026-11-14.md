# Exchange-rate review — 14 November 2026

The November 13 morning transcript compares a USD 2,000 receipt shown as
1,172,736.168 XAF with calculator quotes of 1,186,460 and 1,187,188 XAF.
These imply, respectively, 586.368084, 593.23 and 593.594 XAF per USD.
The difference from the last comparison is 14,451.832 XAF; it is not a decimal
separator, currency-code or client/contractor disagreement.

A scoped, read-only production check confirmed that the reviewed project's
saved budget rate is **586.368084 XAF/USD**. Its USD 2,000 receipt stores that
same project rate and exactly **1,172,736.168 XAF**. Its `fx_source` is `USD`:
the transaction was already denominated in dollars, then mapped to the saved
project budget. `fx_as_of` records that conversion on November 13; it is not
evidence that the older budget rate was a November 13 market quote. The project
was created on November 11, but the original provider quote timestamp was not
stored. We cannot establish its original market source/date from these records.

## Implemented correction

- Saved BOQ and client-approved budget conversions remain fixed. Receipts keep
  their original currency, verified USD value and project-equivalent snapshot.
- Persisted legacy estimates use the same configured basis as their receipt
  balances. Previously their screen amounts could float with a browser quote
  while their payment totals continued using the configured country rate.
- The browser and receipt reader share feed validation: USD base/parity,
  finite positive rates, provider timestamp, and a maximum age of 48 hours.
  In-memory and session caches expire after one hour. Visible quote screens
  refresh on that interval, focus and visibility changes. Old undated caches
  are discarded. Unavailable market quotes identify the configured fallback.
- Creation previews name ExchangeRate-API and its actual update timestamp.
  This is a daily indicative feed, rather than a bank's executable transaction
  rate. [Provider documentation](https://www.exchangerate-api.com/docs/free).
- Both project views identify the budget rate and its source. Receipt details
  explain the receipt-to-USD and USD-to-project conversion legs separately.
  A missing original date is explicitly shown as unrecorded.
- A revised stage's displayed USD equivalent uses the current approved stage price,
  even when an earlier confirmed ledger amount remains unchanged in history.
- New budget currency/rate changes get a server-generated **save time**.
  New receipt proofs retain that time with their own immutable conversion.
  A save time is distinct from a provider's quote date. Migration does not
  backfill historical dates or rewrite any money.

## Release

The user reports the preceding payment migration and matching application were
released. This change additionally needs
[20261114000200_currency_basis.sql](../supabase/migrations/20261114000200_currency_basis.sql),
after any preceding unapplied migrations, followed by the matching application.
The migration is transactional and replay-safe. No additional environment
variables or provider key are needed. No production data was changed by this task.

Verification includes the reported USD/XAF example, independent browser rates,
cache expiry, invalid/future feeds, dated/fallback labels, French copy, actual
PostgreSQL conversion snapshots, immutable dates, migration replay and unchanged
legacy project/receipt values.
