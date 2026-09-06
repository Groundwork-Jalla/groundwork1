# Groundwork — Beta Feedback Backlog

**Source:** Beta Testers Feedback Implementation, 3 Sep 2026 (Philip / Favour)
**Compiled:** 4 Sep 2026
**Scope:** every item raised in the call, split into bugs and features, with estimates.

---

## Headline

29 discrete items. **~19 dev days** of work excluding the two month-scale builds; **~59 dev days** including them.

Philip's one-week cap covers roughly **a third of the list**. Week 1 as scoped below clears every bug plus the security block — which is the stated reason adoption is stalling — and nothing else. SwyChr ("Switcher") integration is not blocked by items 12–29 and can start in parallel from week 2.

| Bucket | Items | Dev days |
|---|---|---|
| Bugs | 10 | 4.75 |
| Features — small/medium | 15 | 14.35 |
| Features — month-scale builds | 2 | 40 |
| Shelved | 1 | — |
| Admin (closed by this document) | 3 | — |

---

## Bugs

| ID | Item | Area | P | Est. | Notes |
|---|---|---|---|---|---|
| B1 | Admin view renders for non-admin users | Dashboard / Auth | P0 | 0.5d | Treat as an access-control defect, not a UI conditional — verify RLS, not just the render path. |
| B2 | Professional fees calculated at 0.1% instead of 10% | Budget engine | P0 | 0.5d | Ship as a configurable rate in `app_config`; final % pending Vanessa. |
| B3 | Password reset behaves as an auto-login, not a reset | Auth | P0 | 0.5d | Token-based reset with expiry + single use. |
| B5 | Certificate emails send from a personal address | Notifications | P0 | 0.5d | Needs a verified Resend sender (`certificates@`), tied to the infra migration already flagged red. |
| B4 | Recording a payment in a stage redirects to main Payments page | Payments | P1 | 0.25d | Redirect fix only; full in-stage flow is F10. |
| B6 | Invitation email language ignores account language | Notifications / i18n | P1 | 0.5d | EN account received a FR invite. Resolve locale from the recipient account, not the sender session. |
| B7 | Help page email link broken; `hello@` address invalid | Support | P1 | 0.25d | |
| B8 | Support tickets don't reliably notify admin | Support | P1 | 1.0d | Philip suggested Notion. Notification is the easy half — the 24h window needs a named owner. |
| B10 | Default 196-day timeline rejected as unrealistic | Timeline | P1 | 0.5d | **Blocked** on Vanessa. Estimate is implementation only, once the rule exists. |
| B9 | Teams screen pricing display incorrect | Billing UI | P2 | 0.25d | |

**Subtotal: 4.75 dev days**

---

## Features — small and medium

| ID | Item | Area | P | Est. | Notes |
|---|---|---|---|---|---|
| F1 | Password strength indicator + complexity enforcement | Auth | P0 | 0.5d | |
| F2 | Two-factor authentication | Auth | P0 | 1.5d | Enrolment, login challenge, recovery codes. Recommend TOTP over SMS — see Flag 6. |
| F3 | Project creation branches on new vs ongoing build | Creation | P0 | 1.5d | |
| F10 | Record payments inside the stage interface | Payments | P0 | 1.5d | |
| F19 | Professional fee + 5% miscellaneous buffer formula | Budget engine | P0 | 1.0d | **Blocked** on the Philip/Vanessa alignment meeting. |
| F4 | Upload existing plans / BoQ on the ongoing-build path | Creation | P1 | 1.0d | Storage + review state only; no document parsing in v1. |
| F5 | Slide-based step UI for floor details | Creation | P1 | 1.5d | Must make skipping a floor impossible, per Philip. |
| F6 | Collect phone + home address before plan selection | Creation | P1 | 0.5d | Site location stays out — handled manually at go-live. |
| F7 | Default finishing to Standard; premium/luxury moved to the contractor conversation | Creation / Budget | P1 | 0.25d | Engine keeps the 1.45 / 1.70 multipliers; they just stop being user-selectable at creation. |
| F8 | Declutter project dashboard | Dashboard | P1 | 1.0d | Remove payment status, stage progress, predicted timeline. Keep cost allocation. Highlight the main menu bar. |
| F9 | Client dashboard cleanup | Dashboard | P1 | 0.5d | Own projects only; remove upload-evidence and general cost allocation. See Flag 1. |
| F11 | Replace ID upload with payment-name matching | Verification | P1 | 1.0d | See Flag 4 — this one has real exposure. |
| F12 | Restrict certificates to Jalla Verify tier | Certificates | P1 | 0.5d | See Flag 5. |
| F17 | WhatsApp integration | Comms | P2 | 1.0d | **Blocked** on Philip's payment. See Flag 3. |
| F18 | Resources section content | Resources | P3 | 1.0d | **Blocked** on Vanessa's source documents. Explicitly low priority. |
| F13 | Rename the "Danger" section in account settings | Settings | P3 | 0.1d | Suggest "Close account". |

**Subtotal: 14.35 dev days**

---

## Features — month-scale builds

| ID | Item | Area | Est. | Notes |
|---|---|---|---|---|
| F14 | Admin ↔ on-ground verifier communication for stage approvals | Admin | 5d | Sequence this as phase 1 of the comms build — it's the piece the Jalla Verify promise actually depends on. |
| F15 | In-platform communication replacing WhatsApp, incl. video | Comms | 20d | |
| F16 | Payment reporting / bookkeeping integrated with the BoQ | Reporting | 20d | |

**Subtotal: 45 dev days** (F14 counted here, not above)

---

## Shelved / no work

- **Roofing feature** — suspended pending clarity on how it's presented.
- **Project footprint adjustment** — current increase/decrease approach already approved by Vanessa. No change.
- **Project deletion** — archive-only stays; confirmed acceptable.
- **Admin visibility of client projects** — current view confirmed sufficient.

Closed by this document: tally items, split bugs vs features, estimate durations. Meeting summary already produced by Gemini.

---

## Proposed sequence

| Week | Contents | Days |
|---|---|---|
| **1** | B1, B2, B3, B4, B5, B6, B7, B9, F1, F2, F13 | 5.35 |
| **2** | F3, F4, F5, F6, F7 — the whole creation flow in one pass | 4.75 |
| **3** | F10, B8, F8, F9, F11 | 5.0 |
| **4** | F12, F19, B10, F17, F18 | 4.0 |
| **5** | F14 | 5.0 |
| **Month 2–3** | F15, F16 | 40 |

Week 1 is deliberately the trust block: the role leak, the fee maths, the reset flow, the sender address, and 2FA. Those are what a beta tester loses confidence over, and they're the ones Philip named first.

---

## Flags — need Philip's answer, most before week 3

1. **Cost allocation contradiction.** The decisions log says to retain cost allocation on the project dashboard *and* remove it from the client dashboard. Reading it as: keep at project level, remove from the client home view. One line of confirmation needed.

2. **The one-week cap doesn't fit the list.** ~19 dev days outside the two big builds. Either the cap moves or the scope does. Proposal above is the scope-moves version.

3. **WhatsApp integration vs replacing WhatsApp.** Paying to integrate a channel we've committed to replacing. Recommend the thinnest possible wiring and no further investment in it.

4. **Payment-name matching only verifies card payers.** Mobile money and bank transfer on the SwyChr rails may not return a verified account name at all — and SwyChr is the fund custodian, so its KYC posture, not ours, sets what we can rely on. Recommend: keep the ID upload path built but dormant, triggered on flag, and confirm what name SwyChr actually returns before removing anything.

5. **Certificates already issued to Self Verify projects** — revoke, grandfather, or hide? Revoking is the cleanest incentive and the worst experience.

6. **2FA channel.** SMS to Nigeria and Cameroon is expensive and unreliable. Recommend TOTP with email fallback.

7. **Fee change moves every existing quote.** 0.1% → 10% plus a 5% buffer shifts displayed totals by ~15% on every project already in the system, including beta testers'. Decide whether existing projects recalculate or freeze at their quoted figure.

8. **Timeline logic shape.** Is the new timeline a function of floors/footprint/finishing, or a per-project-type table from Vanessa? Different builds.

9. **The alignment meeting is the critical path** for B2, B10 and F19. If it doesn't land before day 3 of week 4, those three slip.
