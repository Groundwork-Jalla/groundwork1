# Groundwork Platform Readiness — Pre-Session Brief

**From:** Favour · **For:** Philip, Vanessa · **Session:** integrated operating architecture, 15 projects

---

## 0. Before the walkthrough — three definitions I want ratified first

The session asks us to define "active project", "on-time weekly verification" and "fully operational on Groundwork". I'd rather propose these up front than let them settle by default during the walkthrough, because my KR is measured against the third one and it currently has no agreed boundary.

**Active project.** Funded (first tranche received on SwyChr rails), scoped (budget and milestone schedule locked), staffed (client + at least one assigned professional on-platform), and at or past its first milestone with a next milestone dated. A project that is created but unfunded, or funded but unstaffed, is *pre-active* and should not count against either KR.

**Fully operational on Groundwork (proposed).** For a given project, all of the following are true on the platform, without me or anyone else intervening in the record:

1. Project, budget and milestone schedule exist as structured data — not a document attached to a shell record.
2. Every party has an account with the correct role and permission scope.
3. Milestone status changes are recorded on the platform, by the party responsible, with a timestamp.
4. Evidence is uploaded against a specific milestone and cannot be silently swapped or backdated.
5. A verification event exists as its own record, attributable to a named verifier, distinct from the contractor's own claim of completion.
6. The client sees the above and takes an approval action on the platform.
7. Payment authorisation is initiated on the platform and the settlement result is written back to the project ledger.

**What I want separated out.** Items 1–6 are mine and I'll own them at 100%. Item 7 depends on SwyChr, which is not integrated and whose intro meeting hasn't happened. If "fully operational" is defined to include settled money movement, my KR becomes contingent on a third party I don't control and can't schedule. I'd propose measuring me on 1–6 plus *authorisation initiated*, and tracking end-to-end settlement as a separate, jointly-owned line with Philip on the SwyChr dependency.

I'm not trying to shrink the work. I'm trying to make sure the number we report at the end of the sprint measures something I can move.

---

## 1. Current platform flow — capability assessment

Live walkthrough in the session. Written summary here so we don't spend the two hours narrating screens.

*Verify markers `‹v›` are mine — confirm against the app before this circulates.*

| # | Step | Status | Blocker / dependency |
|---|---|---|---|
| 1 | Project setup / creation | **Functional** — rebuilt off beta feedback: new-vs-ongoing branch, phone + home address before plan selection, finishing defaults to Standard ‹v› | None |
| 2 | Team & permission assignment | **Partial** — contractor magic-link onboarding works; client and contractor roles exist ‹v›. **No verifier or inspector role exists.** | Decision needed on the verifier model (see §5, D3) |
| 3 | Budget & milestone setup | **Functional as software, blocked as business logic** — 9-section engine calibrated on Vanessa's BoQs | Professional fee still computes at 0.1% against a 10–15% target; 5% misc buffer unresolved; no default timeline since the 196-day default was rejected |
| 4 | Milestone status tracking | **Partial** — canonical status vocabulary defined in the Ledger design system; implementation coverage across the app to confirm ‹v› | Statuses need to map to Vanessa's on-ground stage language or the two systems drift immediately |
| 5 | Evidence upload | **Partial** — file upload exists; binding evidence to a specific milestone with an immutable timestamp is the part to confirm ‹v› | If evidence isn't milestone-bound and tamper-evident, "verifiable proof" is a claim we can't back |
| 6 | Verification | **Not available** | No verifier role → no verification action → nowhere for Vanessa's weekly output to land. This is the single largest gap in the joint system. |
| 7 | Project updates | **Partial** ‹v› | Updates originating in WhatsApp get re-keyed by hand — see risk R5 |
| 8 | Client approval | **Partial** — tier-aware approval routing exists; confirm it covers milestone approval and not only budget approval ‹v› | Depends on 5 and 6 being real; approving unverified evidence is theatre |
| 9 | Payment authorisation & release | **Not available** — Stripe is test-mode only; SwyChr not started | SwyChr integration + intro meeting date. Hard dependency. |
| 10 | Ledger / payment-status update | **Not available** — BoQ-integrated payment reporting and bookkeeping is a month-scale build | Downstream of 9 |

---

## 2. Sample project

I'll have one project configured before the session so we can drive the whole flow live. It will demonstrate steps 1–5 and 7–8 end to end. It will not demonstrate 6, 9 or 10, because those don't exist yet — and I'd rather we look at the actual gap than a mock of it.

---

## 3. Roles, statuses, fields, notifications, approval rules

Pulling the current state directly from the schema and bringing it as a one-page reference: role list and permission scopes, milestone status enum, required fields per milestone, notification triggers and channels, and the approval rules by tier. Notifications are the piece I want scrutiny on — a weekly operating cycle across 15 projects runs on prompts, and email is the only channel we have (Resend; EN/FR language matching not yet implemented ‹v›).

---

## 4. Five platform / integration risks

**R1 — SwyChr is unscheduled and terminal.** Payment authorisation and release is the last step of my KR and the integration hasn't started; the intro meeting is still pending. No amount of work on my side closes the milestone-to-cash loop without it. Needs a date this week.

**R2 — There is no verifier in the data model.** Vanessa's KR produces weekly verification events. My platform has nowhere to put them. Both KRs fail together on this one, and it's invisible if we only look at each side separately — which is exactly why this session exists.

**R3 — Unresolved commercial rules contaminate every project created before they're fixed.** Fee percentage, misc buffer and default timeline are open. Fifteen projects created on the wrong figures is materially worse than fifteen projects created a week later, because re-basing live budgets means going back to clients.

**R4 — Single-engineer capacity with no reviewer.** Concurrent load for this sprint: beta feedback implementation, SwyChr, verification infrastructure, notification reliability, in-platform comms, BoQ bookkeeping. Design and engineering currently have no second pair of eyes. The capacity model on the agenda covers on-ground people; I want an engineering line in it too, with the sequencing decision made explicitly rather than by whatever breaks first.

**R5 — Evidence originates off-platform.** With in-platform comms deferred and disintermediation handled by policy and UX rather than product, the real weekly flow is: contractor posts to WhatsApp → someone re-uploads to Groundwork. That's not a convenience problem. It breaks the provenance claim that the whole verification proposition rests on, and it puts a manual step inside the loop we're calling automated.

*Sixth, noted rather than counted:* GHL sync and notification delivery are the plumbing that makes a weekly cycle actually fire. Recent fixes landed, but this is untested at 15-project volume.

---

## 5. Now / product work / controlled manual

**Operational now (this week):** project setup, team assignment, budget and milestone configuration, evidence upload, client-side visibility. Enough to onboard projects and hold them correctly.

**Requires product work (ranked):**
1. Verifier role + verification event record — unblocks Vanessa's entire weekly output. First.
2. Milestone-bound, tamper-evident evidence — makes verification mean something.
3. Notification reliability + EN/FR — makes the weekly cycle self-driving instead of chased.
4. SwyChr authorisation and settlement write-back.
5. Ledger / payment reporting.

**Can run as a controlled manual process, with conditions:** verification recorded in a structured sheet and back-filled once the verifier role ships; payment authorisation instructed off-platform and logged. Two conditions on any manual fallback — **a named owner who is not me**, and **an expiry date**. Fifteen projects × weekly cycle is roughly 60 manual events a month; unowned, that quietly becomes my job and my build velocity is what pays for it.

---

## 6. Decisions I need out of this session

| # | Decision | Owner | Needed by |
|---|---|---|---|
| D1 | Professional fee percentage — final | Philip + Vanessa | Before any of the 15 are created |
| D2 | Default project timeline (replacement for 196 days) | Vanessa | Same |
| D3 | Verifier model — does Vanessa's verifier hold a Groundwork account and act directly, or does a coordinator record on their behalf? Materially different builds. | Vanessa + me | This session |
| D4 | SwyChr intro meeting date | Philip | This week |
| D5 | Definition of "fully operational" ratified, per §0 | Philip | This session |
| D6 | Owner for each controlled manual process | Philip | This session |

---

## 7. One thing I'd flag about the shape of the session

The agenda asks for a Milestone Assurance Pack, a readiness checklist, a capacity model, prioritised SOPs, a gap list, and named owners — in two hours, from a standing start, while also doing a live platform walkthrough. I don't think all of that survives contact with two hours.

If we have to choose, I'd spend the time on the definitions (§0), the verifier model (D3), and the weekly cycle — because those three determine what the SOPs even say. The pack and the checklist are downstream artefacts that Vanessa and I can draft afterwards against agreed definitions, faster and better than we'd produce them live.