# Stripe setup

*Originally written 18 Aug 2026 · Updated 20 Nov 2026*

> **Status (20 Nov 2026): SUBSCRIPTIONS PAUSED / CHECKOUT DISABLED (HTTP 410).**
> Groundwork operates on free access with no project cap (`167_no_project_creation_cap.sql`) and no contractor-invite cap (`20261109000000_free_access_and_locked_directory.sql`).
> - Both `api/stripe/create-checkout-session.ts` and `api/stripe/create-checkout-session-guest.ts` intentionally return **HTTP 410** (`api/_lib/subscription-checkout-disabled.ts`).
> - `/upgrade` and `UpgradeScreen` have been removed from `src/app/routes.ts`.
> - `profiles_sync_projects_tier` was dropped in `20261109000000_free_access_and_locked_directory.sql`.
> - `api/stripe/webhook.ts` and `api/stripe/portal.ts` remain deployed only to handle any legacy subscription webhook events or billing-portal links cleanly.

---

## Scope — read this first

| Rail | Direction | What moves | Status (20 Nov 2026) |
|---|---|---|---|
| **Stripe** | Homeowner → Jalla | Subscriptions (Jalla Verify) | **Disabled** (checkout returns HTTP 410) |
| **Direct payment + Receipts** | Homeowner → Contractor | Construction stage & substage payments | **Live** (receipt upload, OCR verification, contractor confirmation, automatic overpayment carryover) |
| **SwyChr** | Homeowner → Contractor | Automated local payout rail (XAF) | Backend scaffolding in `api/swychr/`; not live on client stages |

**Contractors are never paid through Stripe.** Stripe Connect does not support payouts to Cameroon, and no construction stage money passes through a Stripe balance.

---

## 0. Vercel ESM module loading (important!)

**Do NOT create `api/package.json` with `{"type": "commonjs"}`.**
An earlier August 2026 version of this document recommended pinning `api/` to CommonJS. That is **obsolete and actively breaks Vercel builds** (`SyntaxError: Cannot use import statement outside a module`).

Groundwork runs on **Vercel Pro** using native ESM (`"type": "module"` in root `package.json`). Every relative import inside `api/` must use an explicit `.js` extension and avoid `@/*` aliases or `import.meta`. This invariant is enforced automatically by `src/lib/email/api-import-graph.test.ts` (see `api/README.md`).

---

## 1. Environment variables (Vercel — server-side only)

Never prefix Stripe or Supabase service-role secrets with `VITE_`.

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_…` / `sk_live_…`) — used by `webhook.ts` / `portal.ts` (and checkout if re-enabled) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) |
| `STRIPE_PRICE_JALLA_VERIFY` | Recurring price ID (`price_…`) — unused while checkout returns 410 |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for server-authoritative writes |
| `SUPABASE_URL` | Supabase project URL (falls back to `VITE_SUPABASE_URL`) |
| `PUBLIC_SITE_URL` | Must be `https://www.tryjalla.com` (`www`, not bare apex which 308-redirects) |

---

## 2. Webhook architecture (`api/stripe/webhook.ts`)

- Endpoint URL: `https://www.tryjalla.com/api/stripe/webhook` (always `www.` — Stripe does not follow 308 redirects).
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
- Verifies raw-body signature, inserts into `billing_events` (unique `stripe_event_id` for idempotency), updates `profiles.subscription_*` with `service_role` (guarded from browser writes by `profiles_guard_subscription_columns`), and forwards `subscription_changed` to GoHighLevel.
- Note: `profiles_sync_projects_tier` was dropped in `20261109000000_free_access_and_locked_directory.sql`, so profile subscription changes no longer overwrite `projects.tier`.

To replay a Stripe event after deleting its idempotency row:

```sql
DELETE FROM billing_events WHERE stripe_event_id = 'evt_…';
```

---

## 3. Re-enabling subscriptions later (if product resumes Stripe billing)

1. Remove the `subscriptionCheckoutDisabled` guard in `api/stripe/create-checkout-session.ts` and `api/stripe/create-checkout-session-guest.ts`.
2. Reintroduce a pricing/upgrade route and decide whether `projects.tier` should sync from `profiles.subscription_tier`.
3. Verify `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_JALLA_VERIFY` in Vercel Production.
4. Reconcile `src/lib/payments/config.ts` (`SUBSCRIPTIONS_ARE_PREVIEW`).
