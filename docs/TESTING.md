# Groundwork — Testing & QA Guide

*Updated: 20 Nov 2026*

| Environment | URL |
|---|---|
| **Local dev** | `http://localhost:5174` (`pnpm dev` — configured in `vite.config.ts`) |
| **Production** | `https://www.tryjalla.com` |

---

## 1. Automated Verification Commands

The repository has **323 Vitest test files** plus **9 live Supabase database integration test scripts**:

```bash
# Unit & component suite (Vitest)
pnpm test

# Run a targeted subset during development
npx vitest run src/lib/lifecycle/ src/lib/projects/ src/lib/i18n/

# Type check & production bundle build
pnpm typecheck          # npx tsc --noEmit
pnpm build              # react-router build
```

### Live Database Integration Tests (require `.env.local` / service-role access)

```bash
pnpm test:boq-db
pnpm test:receipts-db
pnpm test:stages-db
pnpm test:account-roles-db
pnpm test:admin-db
pnpm test:lifecycle-db
pnpm test:team-db
pnpm test:review-db
pnpm test:evidence-db
```

### Guardrail Suites Worth Running After Any API / Email / Copy Change

- `src/lib/email/api-import-graph.test.ts` — ensures every `api/` file uses `.js` relative imports with no `@/*` aliases or `import.meta`.
- `src/lib/email/crm-email-log.test.ts` — ensures every Resend sender logs to GHL best-effort (awaited).
- `src/lib/i18n/homeowner-capital.test.ts` & `src/lib/i18n/data-keys.test.ts` — enforces EN/FR key parity and `Homeowner` capitalization.
- `src/lib/lifecycle/direct-lifecycle-email.test.ts` & `src/lib/lifecycle/lifecycle.test.ts` — verifies Day-0 Resend delivery + zero-duplication handoff to `/admin/sequences`.

---

## 2. Manual E2E Smoke Journeys

For full formal release acceptance rows (`W01`–`W20`), see [`docs/weekly-acceptance-2026-11-16.csv`](weekly-acceptance-2026-11-16.csv).

### A. Signup, Auth & Day-0 Emails
1. Sign up a fresh **Homeowner** and a fresh **Contractor** via `/auth/signup` (verify role toggle contrast in both light and dark modes).
2. Confirm email verification / callback (`/auth/callback`) routes Homeowner → `/dashboard` and Contractor → `/work/onboarding`.
3. Verify Day-0 **Welcome email** arrives immediately via Resend (regardless of GHL status) and `/admin/sequences` logs Step 1 (`CL01`/`CS01`) with Step 2 scheduled at 24h (no duplicate Step 1).
4. Test Google OAuth sign-in and password reset (`/auth/reset-password` → `/auth/new-password`).

### B. Project Creation Wizard (`/projects/new`)
1. Select a country with predefined cities (e.g., Cameroon) → verify the City selection step appears before remaining build details.
2. Create a fresh build and a mid-build project (including contractor-recorded upfront payments with currency selection).
3. Verify **Project Activation email** arrives via Resend (`CL05`/`CS09`) and any upfront-paid stages unlock automatically.
4. Test BOQ upload (`docs/testcases/Devis_R4_Penthouse_Simplifie_Corrige.xlsx`) and verify totals reconcile across Overview, Stages, Costing, and Admin Workspace.

### C. Invitations & Roles
1. Generate a single-use contractor link (`Team` tab) and accept it via `/invite/:token`; verify a second account attempting the same link is rejected.
2. Generate a Homeowner share link from `/work/projects/:id` and accept via `/share/:token`; verify observers/family cannot edit prices or upload receipts.

### D. Stage Work, Receipts, Carryover & Disputes
1. **Before contractor joins (client-origin):** Verify payment upload is gated until primary contractor joins (or "Ask Groundwork to find a contractor" support request works).
2. **Stage/substage pricing:** Propose a stage price change (with mandatory reason) and a substage breakdown from `/work/projects/:id`; verify Withdraw shows its own confirmation message; approve as Homeowner.
3. **Receipts & OCR:** Upload a real payment receipt (same currency and foreign currency); verify OCR verification, conversion details, contractor confirmation (`StagePaymentGate`), and clean separation between *Review payment* and *View receipt* buttons.
4. **Overpayment carryover & alerts:** Upload a receipt exceeding stage budget → verify excess carries forward automatically across subsequent substages (hiding *Request payment* while covered) and flags an overpayment alert in `/admin/action-center`.
5. **Contractor-recorded payment & dispute:** Verify Homeowner sees *"Not right? Tell us"* on contractor-recorded payments and submitting a dispute surfaces in `/admin/action-center`.
6. **Project close-out:** Complete all stages and settle balances → verify `ProjectCloseoutPanel` closes cleanly.

### E. Partner Activation & Admin Portal
1. On `/work` / `/work/partner`: complete partner application and book call → verify partner activation tracker hits **100%** immediately after booking a call (no extra post-booking steps).
2. On `/admin`: verify Overview grouped Recent Activity, Action Center (disputes + overpayments), Finance per-project split (`/admin/finance`), Project Workspace tabs, and `/admin/sequences` (*Needs attention* → *Held & suppressed enrollments*).
3. Switch EN ↔ FR across client, contractor, and admin screens to confirm zero raw translation keys or untranslated error strings.
