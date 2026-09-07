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


## Philip's answers — 4 September 2026

Recorded from his comments on the backlog. Four of the nine open questions are closed,
and three of those unblock code.

| # | Question | Philip's answer | Effect |
|---|---|---|---|
| 3 | WhatsApp integration vs replacing WhatsApp | *"We don't need to replace WhatsApp. We need to bring communication into Groundwork. If integrating WhatsApp is the best way to do that, then let's do it."* | **F17 unblocked.** The conflict with F15 was my reading, not the intent — the goal is comms inside Groundwork, and WhatsApp is a means to it rather than a competing direction. |
| 5 | Certificates already issued on Self Verify | *"Revoke."* | **F12 unblocked.** Cleanest incentive, worst experience — his call, made knowingly. |
| 6 | 2FA channel | *"Clients are based abroad, not in Cameroon or Nigeria. Regardless, can't you use 1) email-based 2FA and 2) authenticator app?"* | **No SMS.** TOTP is built (`src/lib/auth/mfa.ts`); **email-based 2FA is not** and is now required. |
| 8 | Timeline logic shape | *"This is addressed. It is extremely critical that you refer back to the documentation on the timeline formula to make sure you get it right."* | B10/F19 follow the documented formula rather than a new invention. Still gated on the Vanessa alignment. |

### Changed priorities

- **F11 → P2**, down from P1. *"The version of this that should be P1 is simply taking
  away the option of uploading ID as part of profile completion."* So the P1 slice is
  removing the ID upload from profile completion; payment-name matching is the P2 part
  and *"only becomes clearer during SwyChr integration"*. His comment on removing the ID
  upload **stands regardless** of what SwyChr returns.
- **F14, F15, F16 → OKR scope.** F14 is *"a broader collaboration with Vanessa"*; F16 is
  *"only implemented after payments processing and reporting is done"*; F15 is *"major —
  part of your OKR sprint"*. All three leave the weekly schedule and become OKR work.

### Still open

Questions 1, 2, 4, 7 and 9 have no answer yet. **2 and 9 are the ones that hurt**: the
one-week cap still does not fit the list. The alignment meeting has since happened —
see below — leaving only the per-m² baseline outstanding.

---

## The fee figures changed — 4 September 2026

**B2 and F19 above are wrong as written.** They record the 3 September figures, which
Philip reached on his own from tester feedback. The 4 September session with Vanessa
worked the numbers through properly and replaced them. Vanessa's figures govern.

| | 3 Sep (superseded) | **4 Sep — shipped** |
|---|---|---|
| Professional fees | 10% of total | four named line items, below |
| Miscellaneous / contingency | 5% | **2%** |

The single flat professional fee is gone. In its place:

| Line | Formula |
|---|---|
| Site manager | 300,000 XAF × months |
| Quantity surveyor | 55,000 XAF × months |
| Contract lawyer | 100,000 XAF flat |
| Project manager | 5% of construction |
| Verification *(own category)* | 50,000 XAF × 7 stages |
| Design | 5,000 XAF × footprint × floors — **unchanged**, Vanessa confirmed |
| Permit | 2.25% of construction — **unchanged** |
| Contingency | 2% of the subtotal |

Months come from the timeline rule she gave the same day: a bungalow is 14 days, each
storey above ground adds 42. That replaced `PREDICTED_DAYS = 196`, which had quoted a
bungalow and an eight-storey block the same seven months.

Site engineer stays inside the 40% labour split — Philip and Vanessa both confirmed it.

### Still with Vanessa: the per-m² baseline

The fee work above is done and does **not** close the gap testers actually complained
about. The take-off engine still under-prices tall buildings, and the cause is known:
`engine.ts` charges the suspended deck slab (`303`), soffit plaster (`307`) and staircase
(`308`) **once per building** where they belong once per floor. A G+7 is priced with one
deck slab where it structurally needs seven.

Those three are deliberate simplifications from the original calibration — the comment at
`engine.ts:126-128` says so — so correcting them is Vanessa's call, not ours. It moves
every number in the book.

Until she signs it off, an **under-estimate warning** ships in its place: where an estimate
falls below half the regional rule of thumb (footprint × floors × 180,000 XAF for Yaoundé,
scaled by each city's `cost_delta_pct`), the wizard summary and the costing tab tell the
client the figure looks low for a building this size and to have a contractor confirm it.
The threshold was chosen from the engine's own output — it is silent across every one, two
and three storey build, and fires from four storeys up, tracking the defect rather than
noise. It deliberately quotes no second figure.

### Done since the backlog was compiled

| ID | Item | Where |
|---|---|---|
| B3 | Password reset behaves as auto-login | `flow=recovery` marker in `reset-password.tsx` / `callback.tsx` |
| B7 | Help page email link broken; `hello@` invalid | was `hello@groundwork.build` and `hello@jalla.build`; now `contact@tryjalla.com` |
| F1 | Password strength and complexity | `src/lib/auth/password-policy.ts` |
| F2 | Two-factor authentication (TOTP) | `src/lib/auth/mfa.ts`, `MfaChallenge.tsx`, `TwoFactorSection.tsx` — **email 2FA still outstanding, see Q6** |
| F13 | Rename the Danger section | account settings tab now reads *Close account*, per Philip's own suggestion |

## Bugs

| ID | Item | Area | P | Est. | Notes |
|---|---|---|---|---|---|
| B1 | Admin view renders for non-admin users | Dashboard / Auth | P0 | 0.5d | Treat as an access-control defect, not a UI conditional — verify RLS, not just the render path. |
| B2 | Professional fees calculated at 0.1% instead of 10% | Budget engine | P0 | 0.5d | ~~10%~~ **SUPERSEDED — see "The fee figures changed" below.** Shipped as four named line items, not a percentage. |
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
| F19 | Professional fee + 5% miscellaneous buffer formula | Budget engine | P0 | 1.0d | ~~5%~~ **SUPERSEDED — see "The fee figures changed" below.** Contingency is 2%. Unblocked; shipped. |
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

7. ~~**Fee change moves every existing quote.**~~ **Answered.** Every project in the system belongs to a beta tester and no real money is committed, so everything recalculates. No grandfathering, no frozen quotes.

8. **Timeline logic shape.** Is the new timeline a function of floors/footprint/finishing, or a per-project-type table from Vanessa? Different builds.

9. **The alignment meeting is the critical path** for B2, B10 and F19. ~~If it doesn't land before day 3 of week 4, those three slip.~~ **Partly answered** — the 4 Sep session settled the fee figures and the timeline rule, so all three shipped. What remains for Vanessa is the per-m² baseline, below.
