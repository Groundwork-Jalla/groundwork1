# SwyChr ↔ Groundwork — payout API contract audit
*24 Sep 2026 · read-only · no code, no migration, no assumption resolved by us*

> **Status:** questions, not conclusions. Everything below that is marked ⚠️ or ❌ stays
> open until SwyChr answers; Groundwork implements nothing against a guess.

## 0. What this is

The 090 ledger was built before SwyChr's contract was known, with four columns marked
PROVISIONAL for exactly this moment. This maps what the meeting and the API screenshots
actually establish onto that ledger, and names what is still missing. It is written to be
sendable to SwyChr: every "missing" line is a question they can answer.

**Scope split, proposed:**
- **Payout rail** — documented enough to design an adapter against. Audited below.
- **Wallet / funding / authorisation** — no contract seen. Held. §5.

---

## 1. What the ledger already is

`payments` (090) — one row per movement, `direction in|out`:

| column | meaning |
|---|---|
| `project_id`, `stage_id` | what the money is about; one `in` row per stage (unique index) |
| `direction`, `state` | `in`: expected → funded → reconciled · `out`: release_authorised → initiated → disbursed, with failed / reconciling |
| `amount` `numeric(14,2)`, `currency` **`USD` \| `XAF` only**, `fx_rate` | the figures |
| `beneficiary_id` **uuid, no FK** | who receives an `out` — a Groundwork account, *not* bank details |
| `authorised_by` / `authorised_at` | who released it (admin; `authorise_release` is `is_admin()`-gated) |
| `provider`, `provider_ref`, `provider_status`, `provider_payload`, `settled_at`, `failure_reason` | **PROVISIONAL — shaped for this audit** |

`payment_events` — the provider's report verbatim, `UNIQUE (provider, provider_event_id)`
as the idempotency key; `record_payment_event()` matches an event to a payment by
`payment_id` **or** `(provider, provider_ref)`, applies the legal transition, and marks
anything else `unmatched` rather than guessing.

Guards that already exist: a release cannot exceed `payment_milestone_usd`; an `out` row
cannot exist without an authoriser and a beneficiary; the beneficiary must be an accepted
contractor on that project; illegal state transitions raise.

---

## 2. Endpoint-by-endpoint mapping (payout rail)

### 2.1 `create_transaction` — initiate a payout

| SwyChr field | Groundwork source today | Verdict |
|---|---|---|
| `transaction_id` | Groundwork-generated candidate reference | ⚠️ **persistence mapping unresolved** — see the note below |
| `amount` | `payments.amount` | ✅ — but currency/decimals unstated (§4.2) |
| `country_code` | `projects.country` | ✅ |
| `payment_method` | — | ⚠️ no column; needs one, or derives from the beneficiary record |
| `beneficiary_name` | `profiles.full_name` of `beneficiary_id` | ⚠️ often empty in production today |
| `mobile_no` | `profiles.phone`? | ❌ **not stored for contractors in a payout-usable form** |
| `bank_code`, `account_number` | — | ❌ **nowhere in Groundwork** |
| `address`, `remarks` | `payments.note` for remarks | ✅ remarks; address ❌ |

**Two identifiers, and we must not guess which is which.** `create_transaction` takes a
`transaction_id` we generate; `transaction_status` returns **both** `transaction_id` *and*
`provider_reference`. That strongly suggests they are different things — ours and theirs —
and `record_payment_event()` matches incoming events on `(provider, provider_ref)`, so
putting the wrong one in that column would silently break correlation.

> **Q.** Please confirm the distinction between `transaction_id` and `provider_reference`:
> which is caller-supplied, which is SwyChr-generated, which should be used to retrieve a
> transaction, to correlate a webhook, and to reconcile; and whether `provider_reference`
> exists immediately on creation or only once downstream processing begins.

Until that is answered, neither is mapped to `provider_ref`.

**The beneficiary finding:** `beneficiary_id` is a uuid pointing at a person, deliberately — 090 stores
*who*, never *how to pay them*. `create_transaction` wants the how, on every call. Two
architectures, and **SwyChr must tell us which they support**:

- **(i) SwyChr holds beneficiaries.** We send a stored beneficiary/recipient id; bank
  details never enter Groundwork. Preferred, because Groundwork would avoid storing and
  verifying sensitive payout credentials and the security and compliance burden that
  comes with them.
- **(ii) Groundwork holds them.** Then this is not a column on `profiles`. It is a
  `payout_methods` record per person — method, bank code, account number, phone, account
  holder, country/currency, verification status — with its own lifecycle: adding and
  changing an account, verifying it, an audit trail, preventing an operator from silently
  substituting payout details, and deciding whether a change requires the contractor's own
  confirmation. Real scope, real liability, a decision Favour should take deliberately.

> **Q.** Do you maintain a beneficiary/recipient object we can create once and reference by
> id? Do you offer account-name resolution or verification, or do we submit an account
> number and bank code unverified? Are `mobile_no`, `bank_code` and `account_number`
> conditionally required by `payment_method` — the bank-transfer example in the docs
> appears to mark `mobile_no` required, which we suspect is unintended.

### 2.2 `transaction_status` — poll one payout

| SwyChr field | Groundwork column | Verdict |
|---|---|---|
| `transaction_id` | **unresolved** — retained verbatim in `provider_payload` | ⚠️ §2.1 |
| `provider_reference` | **unresolved** — retained verbatim in `provider_payload` | ⚠️ §2.1 |
| `status` | `provider_status` (verbatim) + mapped to `state` | ✅ **needs their full status vocabulary** (§4.3) |
| `amount`, `currency` | reconcile against `amount` / `currency` | ✅ |
| `updated_at` | provider observation timestamp (kept in `provider_payload` / the event) | ✅ — **not** `settled_at`; see below |
| `failure_reason` | `failure_reason` | ✅ |

Both identifiers are kept **verbatim in `provider_payload`** during discovery, and
**neither is promoted to `provider_ref`** until §2.1 is answered. `provider_ref` is the
column `record_payment_event()` correlates on; filling it with the wrong identifier would
not fail loudly, it would quietly stop matching events to payments.

`settled_at` is written **only when SwyChr confirms a successful payout**. `failed`,
`reversed` and `refunded` are terminal too, and a row that records the moment a payment
failed as the moment it "settled" would be a lie the ledger then repeats forever. The
provider's timestamp is still kept — on the event and in the payload — without claiming
settlement.

> **Q.** What exactly does HTTP `200` from `create_transaction` mean — accepted, queued,
> processed, or paid? And which `status` values are terminal?

This response is a good fit for the ledger as built. The gap is not the shape — it is
**how we learn a status changed** (§4.4).

### 2.3 Supported payout methods by country · 2.4 Nigerian bank lookup
Reference data for a payout form. No ledger impact. Bank lookup implies **(ii)** above —
worth asking whether it exists *because* the caller is expected to hold account details.

### 2.5 `fiat → PUSD` conversion · 2.6 `PUSD → fiat` rate
**Not modelled anywhere in 090.** These imply the money crosses a stablecoin leg between
funding and payout. Questions this raises, none answerable from here: is the PUSD leg
internal to SwyChr or something Groundwork initiates? Which side bears the spread? **At
what moment is the rate fixed** — quote, initiation, or settlement? `payments.fx_rate`
exists but nothing records *when* it was struck, which is precisely the number a client
will dispute.

### 2.7 Authentication
Documented. Authentication credentials and tokens remain server-side secrets: never in
client code, never in the repository. The exact storage and rotation mechanism is an
implementation concern for later.

> **Q.** JWT lifetime and refresh mechanism; authentication rate limits; whether
> concurrent server requests may share one token.

---

## 3. The authority chain changed

090 treats **admin authorisation as the release trigger**: `authorise_release()` is
`is_admin()`-only and writes a `release_authorised` row. The meeting puts a **client
authorisation with email/OTP after it**:

```
stage complete → evidence → verifier finding → admin approval
   → payment-eligible → CLIENT AUTHORISES (OTP) → SwyChr payout
   → pending/processing → paid | failed → refunded
```

Consequence, stated plainly: **there is today no state and no column for "the client
authorised this release."** `release_authorised` currently means *an operator said so*.
Adding the client step is a ledger change, and there are at least two shapes it could
take — a further state (`release_authorised → client_authorisation_pending →
client_authorised → initiated`), or a separate immutable authorisation record that a
payment references. **Neither is chosen here.** Who signs determines what we can
truthfully record, so the questions come first:

> **Q.** What does the OTP actually authorise — a Groundwork action, or a wallet
> transaction? Who signs the underlying transfer? What callback or proof does Groundwork
> receive that the client authorised it, and can it be verified independently afterwards?
> Can Jalla execute a payout **without** that client authorisation?

---

## 4. Blockers — questions only SwyChr can close

1. **Identifiers and idempotency.** Which of `transaction_id` / `provider_reference` is
   ours and which is yours (§2.1)? Is the caller-supplied one required to be unique, and
   does repeating it return the original transaction rather than paying twice? This is the
   single most important answer for money, and it also decides what `provider_ref` stores.
2. **Currency and decimals.** `payments.currency` allows `USD | XAF` — XAF is already
   representable; **NGN is not**. Which currency does `amount` carry on
   `create_transaction`, and is it minor units or a decimal? PUSD is deliberately *not*
   proposed as a ledger currency: unless SwyChr confirms Groundwork must account for that
   leg itself, we treat the stablecoin conversion as provider-internal settlement
   infrastructure and record only the fiat we sent and the fiat that arrived.
3. **Status vocabulary.** Every value `status` can take, and which are terminal. Our
   mapping is `initiated → disbursed | failed`, and an unmapped status becomes `unmatched`
   by design rather than a wrong transition.
4. **Timeouts and recovery.** Request timeouts, retry rules and rate limits — and
   specifically: after a timeout where Groundwork does not know whether you received the
   request, what is the safe recovery procedure? (This is where question 1 stops being
   theoretical.)
5. **Webhooks — the biggest structural gap.** `payment_events` is built around
   `UNIQUE (provider, provider_event_id)`. Nothing in the screenshots documents a webhook
   for payout success, failure, reversal or refund. If there is none, we must poll
   `transaction_status`, and polling has **no event id** — we would have to synthesise one
   (e.g. `ref:status:updated_at`), which weakens the idempotency the table was designed
   around. Ask for: webhook existence, signature scheme, retry policy, and whether each
   delivery carries a unique event id distinct from the transaction id. **If there is no
   webhook: what polling frequency do you recommend, and what are the rate limits?**
6. **Beneficiary storage** — §2.1 (i) or (ii).
7. **Fees.** Still owed from the meeting. Netted from `amount` or charged separately? A
   netted fee means the contractor receives less than the milestone says, which the ledger
   currently has no way to express.
8. **Failure and reversal.** Mobile-money failures refund principal and charges; bank
   reversals may be slower/manual. Is a refund reported as an event, and does it reference
   the original `transaction_id`? `payments` has `failed` and `reconciling`; a **refunded**
   state does not exist yet. Is a reversal a new transaction, a state change on the
   original, or a separate reference?
9. **Reconciliation.** Can transactions be **listed by date range and status**, not only
   fetched one at a time? Webhooks tell us something happened; reconciliation is how we
   prove our record matches yours.
10. **Country coverage.** The bank-list endpoint we have seen is Nigeria-specific. Which
    payout methods and bank-list endpoints exist for **Cameroon** — our primary market —
    and the other target countries? The meeting discussed Cameroon mobile-money limits and
    bank payouts; we have no documented contract for either.

---

## 5. Held, deliberately

- **No wallet, custody or key handling.** The notes contain two incompatible
  architectures — one where Jalla controls the private key, one where the client's own
  authority (OTP/device/third-party code) releases funds. Until SwyChr and Favour settle
  which is real, nothing about wallets is designed here.
- **No "escrow" wording.** Whatever the notes call it, Groundwork's UI keeps its neutral
  language until the legal arrangement is confirmed. [[financial-custody]]
- **No migration.** The provisional columns stay as they are until the contract questions
  in §4 are answered sufficiently to design the ledger changes deliberately. Several of
  those answers change the shape — currency, a refunded state, how a fee is expressed,
  client authorisation, beneficiary storage, which identifier `provider_ref` holds — and
  one migration written afterwards is cheaper than three written now.

## 6. What can proceed once the blocking contract questions are answered

Five of §4 block the shape of the adapter itself: **identifier/idempotency semantics, the
full status model, the webhook-or-polling contract, who owns beneficiary storage and
verification, and what the client authorisation actually authorises.** Until those five
are answered, nothing here is buildable without a guess. The rest — fees, reversals,
reconciliation, FX timing, country coverage — change details rather than structure.

Once they are answered: a **payout adapter** behind the same seam the Inbox uses for WhatsApp — Groundwork decides
*that* money may move, a provider module decides *how* — carrying only §2.1/§2.2 and
guarded by the existing ledger RPCs. The payout rail can be scoped independently of the
wallet layer. The wallet, funding and signing work cannot be scoped at all from the API
material currently available.
