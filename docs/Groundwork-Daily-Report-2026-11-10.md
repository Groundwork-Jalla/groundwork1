# Groundwork — Daily Report

**Date:** 10 November 2026
**Covers:** the action list from the 9 November meeting
**Status:** 9 of 12 items closed · 1 not reproducible · 2 need a decision from you
**Code state:** everything staged on `main`, nothing committed or deployed

---

## 1. Headline

Nine of the twelve items from Monday's meeting are built and verified. One — the
stage cost distribution — I could not reproduce and have not guessed at; it needs a
screenshot. Two are decisions rather than work, and are waiting on you.

Two defects were found during the work that nobody had reported. Both were in the
money the client is shown, and both are fixed.

Nothing is committed. Every change is staged by exact path and ready for you to
review and push.

---

## 2. Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | clean |
| Production build (`vite build`) | clean, 2.5 s |
| Test suite | **3,808 passing**, 9 failing |
| Tests added today | 48 across 3 new files |
| Files changed | 32 — **+1,740 / −244** lines |
| Migrations added | 1 (182), verified on local PostgreSQL 16 |

The 9 failures are the pre-existing baseline, unchanged by any of this work. They sit
in six files: `partner-funnel` (3), `wizard-draft` (2), and one each in
`payment-receipt`, `whatsapp-recipient`, `partner-qualification` and `client-view`.
Two of them — the `wizard-draft` pair — are telling the truth about a real
contradiction, which is item 11 below.

---

## 3. What was built

### 3.1 The forced scroll on the contractor agreement is gone

**Was:** a contractor could not tick "I agree" until they had scrolled to the last
line of the terms. On a phone that is a long way, and it taught people to flick to
the bottom without reading.

**Now:** the tick is available immediately. Nothing about the record weakens —
`accept_agreement` (migration 116) still records who signed, which version the
*database* chose, the name they typed, and a timestamped activity row.

**One thing added that was not asked for:** switching the document or the language
now clears the tick and the typed name. Without that, somebody could agree to the
English terms, switch to French, and submit a signature against text nobody had read.

### 3.2 Documents open in the app

**Was:** every document in the vault could only be downloaded. To look at one
certificate you downloaded a file, found it, opened it in another application, and
came back.

**Now:** filenames are clickable and there is an eye button beside Download on both
the desktop and mobile rows. Download is untouched for anybody who wants the file.

### 3.3 Project money is shown in CFA Francs

**Was:** every client money screen printed US dollars.

**Now:** a project shows its own currency throughout — Overview, Budget, Stages, the
Payments ledger, the pre-tracking gate and the exported budget PDF. One project, one
currency, one exchange rate, held in one place so two panels on the same screen can
never disagree.

**This did not re-open the exchange-rate question.** The live-rate mechanism already
existed — it was built on 29 October for the contractor Work screens and fetches a
real rate, falling back to the stored one. The fix was to point the client screens at
a mechanism we already had.

**Checked end to end:** a Cameroon project stored at $44,480 renders **26,688,000
XAF**. The real bill of quantities for that building is 26,687,728 XAF. Those agree
to within a rounding step.

### 3.4 The outstanding balance was wrong — root cause, not a patch

**Was:** the Overview showed "outstanding" as *total budget minus what had been
paid*. On an unpaid project it printed the whole budget twice, and it could never
reach zero even on a fully paid one.

**Why:** the stage milestones only cover construction and design. The permit,
professional, verification and contingency fees are separate records attached to no
stage at all. Subtracting from the grand total therefore left those four fees stranded
in "outstanding" forever.

**Now:** both sides are added up from the actual obligations — the stages plus the fee
records. Planned = Paid + Outstanding now holds, and it reaches zero when the project
is settled.

### 3.5 A second defect in the same card, which nobody had reported

While fixing the above I found that the per-category "paid" bars — how much of
Materials, Labour, Permit, Design had been paid — were not read from anything that had
been paid. They were produced by running the *pricing formula backwards* over the
paid total.

The practical effect: pay the first construction milestone, and the permit bar fills
in proportionally, reporting a permit fee as partly paid when no permit had been paid
at all.

Those figures now come from the actual stage and fee records. If no permit has been
paid, the permit bar is empty.

### 3.6 Contractors and Messages are off the client menu

The client sidebar goes from nine items to seven, which also reshuffles the mobile tab
bar. The dashboard was duplicating both doors, so the Contractors quick-action card is
gone and the Messages card now appears only when there is a build for it to open.

**The routes stay registered.** Notification emails, the bell's fallback and anyone's
bookmarks already point at both, and a dead link is a worse answer than a page nothing
signposts. This removes the signposting, not the destination.

A small side benefit: dropping the Contractors card also removed a database count
query that ran on every single dashboard load and now renders nothing.

### 3.7 Floors can be corrected on the summary

**Was:** the floor count was editable in exactly one situation — the document upload
path, and only when reading the plan had *failed*.

The two cases that actually matter were both missing. First, extraction succeeding but
being **wrong** — the floor count is parsed out of a bill title like "Mr.NAS G + 1", and
a ground-floor plan showing a staircase states no storey count at all. Second, the
ordinary path, where floors were buried inside a joined "Scale" line and could not be
touched.

**Now:** editable in both, with one catch handled. Step 4 of the wizard deals with a
floor change by *clearing every room*. That is harmless there, because rooms are asked
for on the very next screen. On the summary it would have thrown away the longest
piece of work in the whole wizard because somebody corrected 2 to 3. The new shared
helper **resizes** instead: existing floors keep their rooms, new floors start empty,
and the room totals the budget is priced from are recalculated in the same step.

### 3.8 The invited client can now see their own house

**This was the largest single finding of the week, and nobody had reported it** —
because it produces no error anywhere.

A client reaches Groundwork two ways:

- **self-created** — they signed up and ran the wizard, and own the project record
- **invited** — their contractor set the build up (which is the normal case we
  designed for in migration 166), so the contractor owns the record and the client is
  invited onto it

Every client screen asked the database for "projects where the owner is me". So the
invited client signed in and the dashboard, My Builds, Documents and Payments *all*
told them they had no builds and offered to help them start one — on the platform
their own house was being tracked on. The only thing that worked for them was the
deep link in their invitation email.

The permissions were never the problem; the database has returned that project to
that client since migration 112. The question the screens asked was wrong.

**Now:** all four screens load both kinds of build, and the two are kept apart,
because the difference is not cosmetic:

| | self-created | invited |
|---|---|---|
| First quick action | Upload Updates | **Progress Updates** |
| New Project buttons (3 on the dashboard, 2 on the list) | shown | **withheld** |
| Profile completion tracker | shown | **withheld** |
| Build card | status only | **"Shared with you" + why** |

Each of those has a reason behind it. An invited client **cannot** file a site update
— the server refuses them by name — so offering them an Upload button is offering an
action that will fail. They have no project to create and never will, so a profile
tracker whose last item is "First project created" would sit at 67% permanently,
telling them to undo their own onboarding.

The read-only note on the build is deliberate. The alternative is a client who is
paying for a house working out from absent buttons that something is broken. One
sentence — approvals and payments stay with whoever is running the build — answers it.

**Note the test:** a client who has one build of their own *and* one shared with them
is an ordinary client and keeps everything. Only somebody whose builds are all
somebody else's is on the invited path.

### 3.9 Qualified-projects tracking corrected (migration 182)

The definition confirmed on 9 November is that a **verified** project is a *qualified*
project with both sides active on it. The live function did not check it that way — it
asked only whether a client had joined and something had been posted from site, and
never looked at the bill of quantities or the start date.

I reproduced both versions side by side on a local PostgreSQL 16 database against real
rows. That turned up **two** ways into a false "verified", not the one I expected:

| Project | Old rule | New rule |
|---|---|---|
| Client joined + site update, **no bill of quantities** | verified | general |
| BQ + client + site update, **start date 90 days out** | verified | general |
| Everything in place | verified | verified |
| BQ + near start date only | qualified | qualified |

The second is the dangerous one and the one I had not anticipated: the project looks
complete from every angle except the date. The function and the bulk view now agree on
all four cases, which they did not have to — the 30 October meeting opened with
exactly those two numbers disagreeing with each other.

**Production reads 3 qualified, 0 verified**, so no number we have reported has ever
been wrong. That is precisely why it is worth fixing this week: the target is two
verified projects, and the first project to pick up a client and a site update without
a bill of quantities on file would have been counted as verified and would not have
been one. A metric that is only correct while its count is zero is not yet a metric.

---

## 4. Not reproducible — I need a screenshot

**"The stage cost distribution is wrong from stage 5 onwards."**

I traced the stage weightings from where they are defined, through project creation,
through the database function that writes each milestone, and out to all four screens
that display them. Nothing special happens at stage 5. The multi-floor template does
add extra sub-stages at stages 5, 7, 8, 9 and 10 — but it shifts no stage number and
changes no amount.

I have not changed any arithmetic on a guess. If Philip can send the screen he was
looking at, with the project name, I will have it in under an hour.

---

## 5. Decisions waiting on you

### 5.1 The floor plan requirement — my recommendation

You asked me to evaluate whether the floor plan is necessary. It is **already
optional**, and its only load-bearing output is now two numbers a person can type.

The document path requires *both* a floor plan and a bill of quantities. Of everything
we read off the drawing, only the floor count and the building footprint affect
anything, and as of today both are editable on the summary.

So requiring the drawing buys accuracy, not possibility. **I would relax the gate to
require the bill of quantities and make the floor plan optional.** The BQ is what the
pricing is actually checked against, and a client who has the bill but not stamped
drawings is currently pushed onto the estimate-only path for no reason.

That is a product decision, not a cleanup, so I have not touched it.

### 5.2 Session recording / heat mapping — vendor not chosen

This needs a decision before any code. Microsoft Clarity is free, Hotjar is the
familiar one, PostHog can be self-hosted. There is a privacy dimension that is not
optional: these tools record client **financial** screens — budgets, payment amounts,
document names — so whichever we pick needs field masking configured before it goes
anywhere near production, and the privacy policy needs the sub-processor named.

Tell me which one and I will wire it with masking on from the first commit.

### 5.3 The client dashboard — what does "redesign" mean?

The dashboard structure is now correct for both kinds of client. I have **not** done a
visual redesign: our screen-design record has the dashboard as variant B, signed off
on 9 August, with its hero and costing donut already built to that decision. If
"redesign" means something beyond the invited/self-created split, it needs a mockup or
a few sentences, and I would rather ask than repaint a screen that was approved.

---

## 6. Risks to clear before the next deployment

These are not today's work. They are known hazards that should not be discovered
during a deploy.

### 6.1 Two migrations fight over the contractor directory — **verified**

Migration **180** opens the contractor directory to every signed-in account, per your
own words on 9 November: the directory should be admin-curated, not subscription-gated.

A second file, `20261109000000_free_access_and_locked_directory.sql`, redefines the
same database function to admins only.

Migrations run in filename order, and `180…` sorts **before** `2026…`. So the later
file wins and **the directory stays shut to everybody except staff** — the opposite of
what 180 was written to do. 180's own header already flags this.

**Fix:** renumber the two timestamped files into the 18x sequence, or apply them by
hand in the intended order. One line of naming, but it has to happen before deploy.

### 6.2 Migrations 174 and 175 collide with free mode

174 makes the client the approver of a stage; `20261109001000_remove_verification_gates`
switches verification off entirely. They have not been reconciled. Neither should ship
until they have been.

### 6.3 "Record a payment" writes to the browser only

On the Payments page, the Record button saves to local browser storage under a comment
reading *"no payments table yet"*. There has been a payments table since migration 090.

So that button records nothing the admin can see, nothing that survives a different
browser or device, and nothing that reconciles against the ledger — and it sits on the
page next to real figures. It is either a wiring job or a deletion. Your call; I have
left it alone.

### 6.4 The wizard contradicts the Cameroon default

A fresh wizard starts with **no country selected**, added on 28 October so that step 1
reflects an explicit choice. Our standing rule is that Cameroon is the default
everywhere. Two of the nine failing tests are reporting this honestly rather than
being broken.

Both positions are defensible. It is a product call, so I have not changed it, and the
two tests stay red until somebody makes it.

### 6.5 Migration 104 remains on hold

Still held, with the two blocking defects recorded previously: no transaction wrapper,
and no repair pass before the constraints are applied.

---

## 7. What I would do next

1. **Clear 6.1** — ten minutes, and it blocks a correct deployment
2. **Your answers to 5.1, 5.2, 5.3** — each unblocks a build
3. **Philip's screenshot** for the stage distribution
4. **7-day follow-up sequences and walkthrough videos** — the last untouched item
   from Monday, and it needs content written before any code

---

## 8. Everything changed today

All staged on `main`, nothing committed.

**New files**

- `src/lib/budget/project-money-context.tsx` — one project, one currency, one rate
- `src/lib/projects/floors.ts` — shared floor logic, so the wizard steps cannot diverge
- `supabase/migrations/182_verified_is_a_qualified_project.sql`
- Three test files: `project-currency`, `floors`, `invited-client-path` — 48 tests

**Changed**

- Client screens: dashboard, projects list, documents, payments, project detail
- Project components: Overview, Budget, Stage tracker, Payments ledger, Document
  vault, Start-tracking gate
- Wizard: steps 4, 5 and 9
- Contractor agreement reader
- Navigation configuration, budget PDF export, project types, English and French
  dictionaries
- Five existing test files updated where they pinned behaviour that was deliberately
  changed

**Totals:** 32 files, +1,740 / −244 lines.
