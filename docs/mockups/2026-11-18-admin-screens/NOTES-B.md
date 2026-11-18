# Group B — People screens (18 Nov)

Static mock-ups, light mode, 1440 desktop / 390 mobile. Copy comes from `src/lib/i18n/en.ts`. Data is illustrative.
Where a design adds something the code does not have today, it says so under **Added**.

---

## 1. Contractors — `/admin/contractors`
Files: `contractors-desktop`, `contractors-mobile`, `contractors-remove-desktop` (dialog)

**Design.** The page is a directory, so it is a searchable list with a detail pane, plus one amber "act on this" strip at the top for contractor accounts the directory cannot show. Clicking a row opens the oversight pane on the right instead of expanding a table row. The row actions (Hide/Publish, Signup details, Delete) move into that pane, so the table stays scannable.

| Today (code) | Where it lives now |
|---|---|
| `PublishContractor` panel (renders only when there are rows): title, body, rows with name · email · origin (4 kinds) · in directory / entry taken down / not in the directory | Amber strip at the top: "3 contractors not in the directory yet", rows as cards, with Hide list to collapse it |
| Publish → Trade + City fields, Add to directory, Cancel, validation errors, "{name} is now in the directory" | The form opens inline on the row (Serge Fotso). The success line shows under the strip header; errors show under the row |
| Remove their access / Delete (each opens an inline impact check) | Both buttons stay on each row. Both open the **Remove this contractor** dialog, preselected to the mode clicked, with a Remove / Delete toggle (`contractors-remove-desktop`) |
| Impact list: willProjects, willPrimary, willListing, willKeep vs willDelete, willErase, willEraseProjects | In the dialog, with destructive lines in red |
| Money in flight → `blocked` note replaces the form | Right-hand dialog in `contractors-remove-desktop`: the note shows and the action is disabled |
| Reason (optional, recorded); confirm button text per mode; errHistory / errStaff / errSelf / errMoney / errFailed | Reason field and per-mode confirm are in the dialog. Errors show above the buttons (not drawn) |
| Header title and subtitle (`admin.dir.*`) | Page header |
| Chips All · n and Hidden · n | Segmented control |
| Search (`?q=` deep link, matches the translated trade) | Search field, same behaviour |
| Columns: Contractor (name, verified badge, from-application icon, email), Trade, Location, Experience (yrs + "n listed" with hint), Visibility, Added | Same columns. Trade and Location are stacked in one cell. A legend under the table explains the two icons and what "listed" means |
| Hidden rows dimmed | Kept (Ibrahim Moussa) |
| Row expand (`?contractor=`) → `ContractorOversight` | Right pane: Assignments (accepted / invited, relative time, matched-by-email note), Verification history (decision counts, "not a score" or shared-projects note), Evidence filed (count, most recent), Recorded as beneficiary (≤5 rows, amount and ledger state, records-and-governs note), Where this entry came from |
| Oversight states: loading, unavailable, noEmail, domainUnavailable, noAccount, empties | Each renders in place of its pane section (not drawn) |
| Row actions: Hide/Publish toggle, PersonPreview (signup details), Delete → ConfirmDelete with deleteHint and acknowledgement | Pane header: Hide, Signup details, Delete. Delete opens the shared **Delete permanently** dialog (shown in `users-role-desktop`) with `admin.dir.deleteHint` as the acknowledgement |
| Loading, error (loadFailed), empty / emptyFiltered | Standard positions in the list (not drawn) |

**Added:** an "Applications ↗" header link, because entries arrive from applications. The Remove/Delete dialog replaces the inline expansion; the content is the same.
**Moved:** the per-row Hide/Publish button is now in the pane. Hiding takes two clicks instead of one; say if that matters.

## 2. Contractor records — `/admin/contractors/records`
Files: `contractor-records-desktop`, `contractor-records-mobile`

**Design.** This is a read-only record, so it is master-detail. The eight funnel cards are drawn as one strip, grouped into the complementary pairs they are (Onboarding complete/not finished; Application filed/none). On the left is the list with step pips. On the right is the selected person's submission: a step tracker, then six section cards.

| Today | Where |
|---|---|
| Title and subtitle | Header. "Partner pipeline →" is a header button |
| 8 FilterTiles (all, onboarded, notOnboarded, ownClient, applied, notApplied, prequalified, sentToBooking) with counts; click to filter, click again to clear | Funnel strip. The selected tile is black ("Onboarding not finished") |
| Funnel title, worklist link, booking note | Line under the strip |
| Search (name, email, phone) | Toolbar |
| Joined from / through, project status select, onboarding stage select, Clear filters | Toolbar |
| Date and status filters disabled + `communications.tracking.install` notice when the index is missing | Mobile shows the notice state |
| absent (migration 118), loadFailed | Notice above the strip (not drawn) |
| Rows: name / email / userId, email · phone, "Has a homeowner" tag, 5 pips with step tooltip | List rows. The header shows "26 of 64 · filter name" |
| Empty / noMatch | List body (not drawn) |
| Dossier: unfinished banner listing outstanding steps | Amber banner, plus a 5-step tracker above it (same data, as a visual) |
| Personal (DOB, address) · Licence and business (licence no., business status, name and reg. no. if registered) · Emergency contacts · Paid into (mobile money or bank · account) · Signed (name · version, date) · Homeowner (intent + document links, signed on click, docFailed) | Six cards in a 2×3 grid. "None given" and "—" are kept for missing answers |
| dossierFailed, loading | In the detail pane (not drawn) |

**Added:** the step tracker (derived from the existing `status.steps`). Tile counts now sit above their labels so labels can wrap.

## 3. Partner pipeline — `/admin/partners`
Files: `partner-pipeline-desktop` (board), `partner-pipeline-card-desktop` (editor sheet), `partner-pipeline-mobile` (work list)

**Design.** A pipeline should be a kanban. The 14 stages are grouped into five phases (Ended, Joining, Applying, Deciding, Activating). The stage strip at the top keeps every stage count and is the stage filter. The board has one column per phase, and each card carries its exact stage tag. Clicking a card opens the editor as a side sheet. A Board / Work list toggle keeps today's single list sorted by what needs doing (`sortForWork`).

| Today | Where |
|---|---|
| Title and subtitle | Header |
| absent (migration 145), loadFailed | Notice under the header (not drawn) |
| Stage strip: 14 stages with counts, click to filter, zero-count disabled | Stage map grouped by phase. Zeros are dimmed |
| Search (name, email, phone, specialty, owner, next action) | Toolbar |
| "{n} need attention" | Red tag in the toolbar |
| "Clear {s}" when a stage is picked | Appears beside the tag when a stage is filtered (not drawn) |
| Scope sentence (partners / everyone) + Show those too / Applicants only (only when separable) | Line under the toolbar |
| Internal accounts sentence + Include them / Leave them out | Second line |
| Card: name / unnamed, stage pill, attention flag (5 kinds, tone), ended reason (9 kinds), "No application", subline (specialty, ended note, in the directory, owned by, next action · date / nothing recorded), "{n}d in stage", Review application link | Kanban card: tags row, a next-action chip, a footer with owner and days, and a Review application button |
| Empty / emptyFiltered | Column / board empty (not drawn) |
| Editor: 3 manual stage toggles (call completed, committed, agreement signed) | Sheet: "Mark what the product cannot see" toggles |
| What just happened (placeholder = last action), What happens next, By when, Activation deadline + hint, Notes, Save, saveFailed, "No owner" warning | Sheet form. saveFailed and No owner show beside Save |

**Added:** the phase grouping and its labels ("Joining / Applying / Deciding / Activating / Ended") are new words, not in en.ts. The Board / Work list toggle and the "All stages" tile on mobile are also new.
**Note:** the work order is global today. On the board each column is sorted with `sortForWork`, and the Work list view keeps the exact global order.

## 4. Verifiers — `/admin/verifiers`
Files: `verifiers-desktop`, `verifiers-mobile`, `verifiers-invite-desktop` (sheet)

**Design.** A capacity directory. The question is "who can take this stage", so it is a table with load figures (Projects, Pending in amber, Decided, Last decision). Invite is the primary action and opens a side sheet instead of a permanent form block.

| Today | Where |
|---|---|
| Title and subtitle | Header |
| Invite form: title, body, Full name, Email, Send invitation / Sending…, sent message, 4 error messages + name/email validation | Invite sheet. Success is shown. Errors are listed under "If it does not go through" and render in place |
| Loading, error | List area (not drawn) |
| Empty: "No verifier accounts yet" + body | Mobile shows the empty state |
| profilesUnavailable notice | Mobile, listed as a conditional notice |
| Row: name or email, Available / Unavailable pill (hidden when null), email · city · registration body + no., disciplines / noProfile / noDisciplines | Table columns: Verifier, Registration, Disciplines, Status |
| Stats Projects, Pending (emphasised when >0), Decided; "n/a" when the domain is unavailable | Right-aligned numeric columns |
| Last decision {when} / No verification recorded yet · assign from a project workspace | Last decision column. The hint is in the table footer |

**Added:** 4 summary stats and an All / Available / Carrying-pending filter with search, all derived from the same rows. Say if you'd rather not have them.

## 5. Site Managers — `/admin/site-managers` (placeholder)
Files: `site-managers-desktop`, `site-managers-mobile`, `site-managers-proposed-desktop`

**Design.** The honest empty state: the real placeholder body, a "Not built yet" tag, what the page will hold, and where the related data lives today (Projects → Team, Budgets & fees → site manager fee line, Site Updates). The proposed version is a directory with visits and budget lines, labelled "Proposed — needs a data source".
**Checklist:** title, placeholder body, no `existingTo` link (none is configured), notFound state (unchanged).
**Added:** the related-places card and "To build this page" card. The proposed page is a concept only. Site manager is not a role today (IA doc 01 §5).

## 6. Users — `/admin/users`
Files: `users-desktop`, `users-mobile`, `users-role-desktop` (role editor, after-save review, delete)

**Design.** A directory with a role filter and a signup-details side pane (PersonPreview). "Create an account" is the primary action. CRM backfill drops to a slim card under the table.

| Today | Where |
|---|---|
| Title "All Users", "{n} registered" | Header |
| Search (email, name, role; `?q=`) | Toolbar |
| Create an account → /admin/users/new | Primary button |
| `CrmBackfillPanel` (Preview → counts → Send to n / Backfill n, confirm, page n…, result log, failed) | Slim card under the table, with Preview first. It expands to the counts, send buttons and log as today |
| Notice (deleted, deleted with projects, role updated) | Green banner under the header |
| Loading, usersLoadFailed | List area (not drawn) |
| Columns: Name (opens PersonPreview), Awaiting first sign-in badge + hint, Email, Role pill + "Change user role", Plan, Projects, Joined, short ID, Delete | Name and email are combined. The badge sits under the email. The role pill shows, with "Change user role" on the selected row and in the pane. Plan, Projects and Joined are their own columns. The ID moved into the pane (User ID). The trash icon stays |
| No users match "{q}" | Mobile shows it |
| UserRoleEditor: title, email, hint, Account role select (4 roles), contractor-repair hint, admin hint, errors (clientPayments, lastAdmin, stale, notAdmin, failed), Save role / Repair contractor project access (disabled when unchanged), after-save reviewNeeded + Review project n links + Close | `users-role-desktop`, left and middle dialogs |
| ConfirmDelete: Delete permanently, subject, userProjects / userNoProjects acknowledgement, selfDelete / lastAdmin errors | `users-role-desktop`, right dialog |
| PersonPreview (contact, call, WhatsApp, language, account, onboarding, application, projects) | Right pane |

**Added:** role filter tabs (counts are derived), and "Change user role" and "Delete account" inside the pane. `AccountTypeEditor` is not imported by this route, so it is not drawn.

## 7. Users → Create an account — `/admin/users/new`
Files: `users-new-desktop`, `users-new-mobile`, `users-new-done-desktop` (handover)

**Design.** A form plus a "what happens next" rail. The three roles are cards, each with its own hint, so the choice explains itself. The handover screen puts the two credentials in one card with Copy buttons, and the shown-once warning sits right under them.

| Today | Where |
|---|---|
| Back to users, title, subtitle | Crumbs, a back button and a shorter lead. The rest of the subtitle (the first sign-in steps) moved to the right rail |
| Role radio (homeowner, contractor, verifier) + per-role hint + roleLocked | Role cards. roleLocked sits under them |
| Full name, Email + hint, Phone (optional), Country (COUNTRIES, Cameroon default), Language for emails (EN/FR) + hint | Form grid |
| Errors errName / errEmail / errTaken / errFailed, field highlighting | Error note above Create account. errTaken and the email field highlight are shown |
| Create account / Creating…, submitHint | Bottom of the form |
| Handover: doneTitle, doneSubtitle, Username + Copy/Copied, Temporary password + Copy, onceWarning, next1–3, Create their project (homeowner) or doneContractor / doneVerifier text, Create another account | `users-new-done-desktop` |

## 8. Agents — `/admin/agents` (placeholder)
Files: `agents-desktop`, `agents-mobile`, `agents-proposed-desktop`

**Design.** An honest empty state that also clears up the naming: Agents means sales and field agents and referral partners. The software agents' desk is Automation Requests, which is linked, as are Quote Requests and CRM, where referred homeowners show up today. The proposed version is an agent list with referred, projects, waiting and conversion figures, labelled "Proposed — needs a data source".
**Checklist:** title, placeholder body, notFound (unchanged).
**Added:** disambiguation links, "To build this page", and the proposed concept. Agent pay is deliberately left out (it needs its own design pass).
