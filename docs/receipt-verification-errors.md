# Receipt verification: clear errors and service diagnostics

The review reported the same unavailable message for an unrelated PNG and an actual
NGN receipt with the correct entered amount. Those outcomes must be distinguished
from a failed document check.

## Findings

The previous endpoint returned `receipt_reader_unavailable` for a missing reader
key, receipt-reading database failures, and unclassified provider exceptions.
It also treated non-receipts, unfinished payments and unclear receipts as one
unreadable outcome. Truncated model output was attributed to the document.

Read-only checks during this fix established that:

- `ANTHROPIC_API_KEY` is absent from the local environment and was omitted from
  `.env.example`.
- The connected Supabase database has the receipt-reading, currency conversion and
  pricing revision fields. Its receipt-reading table has no attempts.
- No connected browser or Vercel authentication was available to inspect the
  Production environment variables or deployment logs. A Vercel integration was
  found and offered; installation and authorization were not confirmed.

This points to a failure before reservation/extraction in the tested deployment.
It does **not** prove that the Production reader key is missing. The user answered
“Not sure” when asked about Production configuration. No receipt contents, file URLs, user IDs,
API key values or entered amounts were printed by these checks. No production
data was changed.

## Implemented behavior

| Outcome | API result | Client guidance |
| --- | --- | --- |
| Unrelated image/document | `receipt_not_receipt`, 422 | Choose an actual completed-payment receipt |
| Invoice, pending or failed payment | `receipt_payment_not_completed`, 422 | Upload the successful payment receipt |
| Receipt amount/currency cannot be read clearly | `receipt_unreadable`, 422 | Use a clearer receipt or unlocked PDF |
| Extracted amount differs from input | `receipt_amount_mismatch`, 422 | Enter the amount actually read from the receipt |
| Extracted currency differs from selection | `receipt_currency_mismatch`, 422 | Select the currency actually read from the receipt |
| Missing key, database migration/permissions, provider credentials/model/billing/request setup | `receipt_reader_not_configured`, 503 | The file was not checked; contact Groundwork with the check reference |
| Provider rate limiting | `receipt_reader_busy`, 503 | Retry shortly with the retained file |
| Check timed out | `receipt_reader_timeout`, 504 | Retry the retained file; do not blame document quality |
| Truncated, malformed or invalid model response | `receipt_reader_response_invalid`, 502 | The check did not complete; retry or contact Groundwork |
| Browser connection interrupted | `receipt_network_error` | Reconnect and retry |
| Currency feed unavailable after a successful match | `receipt_rate_unavailable`, 503 | Retry the conversion with the retained receipt |

English and French messages distinguish these cases. The file, input amount and
selected currency remain in the current form after a failure. A file is described
as a non-receipt only after a successful document-reading response classifies it;
service configuration failures never invent a document classification.

The model now explicitly classifies completed receipts, unrelated documents,
unfinished payments and unreadable files. Amount matching remains exact and uses
only the payment amount/currency on the receipt, independently of the stage
allocation. A fixture NGN 13,000 receipt is accepted on an XAF project. That is a
regression test, not a claim that the user's actual uploaded receipt was read live.

The default Sonnet 5.5 call disables up-front thinking with `between_tools` and
allows 1,024 output tokens. Custom model overrides do not receive this
model-specific option. This follows the provider's
[Sonnet 5.5 thinking configuration](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5).
Truncated JSON and unexpected response shapes are processing failures. Enum and
currency casing are normalized; monetary strings are retained exactly. See the
provider's [structured output caveats](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Non-receipts and unfinished payments persist using the existing database
`unreadable` status and issue no proof. A successful reading survives a later
currency-service failure so a retry reuses that extraction. The existing submission
RPC still requires both the matched file reading and its saved conversion. No
failure records a payment or opens a stage, and no new migration is required.

## Live provider check — November 13, 2026

After the user added the key, `ANTHROPIC_API_KEY` was present in the ignored
`.env.local`. A live, read-only Anthropic model-list request authenticated
successfully and listed both configured reader models as available.

Two small synthetic documents were then sent through the actual
`readPaymentReceipt` implementation, without creating receipt-reading records or
project payments:

- An unrelated PNG was classified as `not_receipt`.
- A completed-payment PDF for NGN 13,000 matched the entered NGN 13,000 exactly.
  The transaction fee and account balance were excluded. Applying the actual
  matching function to that live extraction also identified an incorrect amount
  and an incorrect currency.

These provider checks passed and establish that the locally configured key can
make the extraction requests. They use synthetic documents, not the user's actual
receipt. Production environment configuration, redeployment and authenticated
upload/payment acceptance still need verification; no Vercel authentication was
available for this check. Key values and provider response bodies were not logged.

## Production setup and diagnosis

1. In the Vercel project, check **Settings → Environment Variables** for a valid
   server-only `ANTHROPIC_API_KEY` enabled for **Production**. Development and
   Preview settings do not establish its presence in Production.
2. Leave `RECEIPT_READER_MODEL` empty unless an intentional, accessible model is
   configured. Ensure the provider account permits the selected model and has
   available API credit.
3. Deploy the matching frontend and API. Environment changes apply to a new
   deployment, as described in
   [Vercel's environment-variable instructions](https://vercel.com/docs/environment-variables/managing-environment-variables).
4. Test the unrelated PNG, a clear completed NGN receipt with its exact amount,
   amount/currency mismatches and an unclear image. Compare the distinct outcomes.
5. For a service failure, search deployment logs for `[receipt-reader]` and the
   check reference shown in the form. The API also returns it in
   `X-Receipt-Check-Id`.

Logs contain only the application reference, processing phase, failure code,
operational reason, database error code, provider HTTP status/request ID and stop
reason when available. They do not include provider bodies, receipt contents,
signed URLs or credentials. Request IDs follow the provider's
[documented support mechanism](https://platform.claude.com/docs/en/api/errors).

`reader_key_missing` identifies a missing server key; `database_migration_missing`
identifies the required database setup; `provider_credentials_or_model` and
`provider_billing` identify different provider setup problems. These details remain
in server logs rather than becoming implementation instructions in the client
payment flow.

## Local verification

- Full Vitest suite: **4,573 tests passed across 260 files**.
- Final typecheck and production build: passed.
- `git diff --check`: passed.
- Receipt regressions cover document classification, NGN 13,000 matching,
  amount/currency mismatches, missing configuration and migrations, provider
  credentials/rate limits/timeouts, malformed/truncated responses, support-reference
  redaction, retained form values and reuse of a reading after conversion failure.

Automated regressions use fixture model responses. The later live provider check
above used synthetic documents successfully. Recognition and acceptance of the
user's actual receipt remain dependent on confirming Production reader
configuration and testing the deployed upload flow.
