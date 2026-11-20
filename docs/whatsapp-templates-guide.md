# Groundwork WhatsApp Templates — Team Reference & Meta Approval Guide

> **Audience:** Operations, Growth, and Support staff using **Admin → Inbox → WhatsApp** (`/admin/inbox?channel=whatsapp`) and **Admin → Sequences** (`/admin/sequences`).  
> **Scope:** All **43 Groundwork templates (86 English & French variants)** running on Meta WhatsApp Cloud API `v27.0`.

---

## 1. Ground Rules for Staff Using WhatsApp

1. **The 24-Hour Customer Service Window**
   - **Window OPEN** (recipient messaged Groundwork within the last 24 hours): You can send **free-text replies** directly in `/admin/inbox?channel=whatsapp`.
   - **Window CLOSED** (no inbound message in the last 24 hours, or starting a brand-new conversation): Meta **blocks free-text messages** (error `131047`). You **must select an approved template** in the recipient's preferred language (`en` or `fr`). Once they reply, the 24-hour window reopens.
2. **Consent & Opt-Out (`START` / `STOP`)**
   - Every template includes the mandatory footer (`Reply STOP to stop reminders.` / `Envoyez STOP pour arrêter les rappels.`).
   - If a recipient sends `STOP` / `UNSUBSCRIBE` / `ARRÊT`, Groundwork immediately stops outbound WhatsApp reminders until they opt back in from their profile.
   - Recipients must connect WhatsApp from their profile (or send the verification `START <token>` message) before automated sends run.
3. **Exact Copy Sync Rule**
   - Groundwork compares the exact compiled template body + footer + URL button against Meta's approved record (`communication_whatsapp_templates`).
   - If you edit a lifecycle step's wording in `/admin/sequences`, its status changes until the updated wording is re-approved in Meta and refreshed via **Check connection**.
4. **Manual Follow-Up Selection Rule**
   - Pick the template that matches **who the person is** (`CS`/`CI` = Contractor, `CL`/`IV` = Homeowner) and **the exact step they are stuck on** (see Section 2 below). Never send a Contractor template to a Homeowner or an invitation template to someone who already joined.

---

## 2. Complete Template Directory (43 Templates · 86 EN/FR Variants)

### Journey A — Contractor Self-Signup (`CS01–CS16`)
*Used for contractors who signed up independently on Groundwork.*

| Template Name | Code | Sequence & Timing | Trigger → Exit Condition | Meta Category | Button | Staff Use Case |
|---|---|---|---|---|---|---|
| `groundwork_cs01` | CS01 | `cs_signup` · Day 0 (`+0h`) | Contractor signs up → Completes onboarding | MARKETING | Complete onboarding | Welcome right after independent contractor signup |
| `groundwork_cs02` | CS02 | `cs_signup` · Day 1 (`+24h`) | Onboarding still incomplete | MARKETING | Continue onboarding | Gentle 24h nudge to finish contractor onboarding |
| `groundwork_cs03` | CS03 | `cs_signup` · Day 2 (`+48h`) | Onboarding still incomplete | UTILITY | Finish onboarding | Explains what unlocking contractor access enables |
| `groundwork_cs04` | CS04 | `cs_signup` · Day 4 (`+96h`) | Onboarding still incomplete | UTILITY | Complete onboarding | **Best for manual check-in:** asks where they are stuck |
| `groundwork_cs05` | CS05 | `cs_onboarded` · Day 0 (`+0h`) | Onboarding complete → First project created | UTILITY | Create your first project | Confirms contractor onboarding is approved/complete |
| `groundwork_cs06` | CS06 | `cs_onboarded` · Day 1 (`+24h`) | No project created yet | UTILITY | Create a project | Prompts adding first active build (or opting out if none) |
| `groundwork_cs07` | CS07 | `cs_onboarded` · Day 2 (`+48h`) | No project created yet | UTILITY | Create a project | Explains organizing milestones & updates in one place |
| `groundwork_cs08` | CS08 | `cs_onboarded` · Day 4 (`+96h`) | No project created yet | MARKETING | Add a project | **Best for manual check-in:** offers help setting up first project |
| `groundwork_cs09` | CS09 | `cs_project` · Day 0 (`+0h`) | Project created → Client invited | UTILITY | Invite your client | Confirms project creation; prompts inviting Homeowner |
| `groundwork_cs10` | CS10 | `cs_project` · Day 1 (`+24h`) | Client not invited yet | MARKETING | Invite client | 24h reminder to invite the Homeowner |
| `groundwork_cs11` | CS11 | `cs_project` · Day 2 (`+48h`) | Client not invited yet | MARKETING | Invite client | Explains shared source of truth for client updates |
| `groundwork_cs12` | CS12 | `cs_project` · Day 4 (`+96h`) | Client not invited yet | UTILITY | Invite client | Offers staff help explaining Groundwork to their client *(see Section 3 rewrite)* |
| `groundwork_cs13` | CS13 | `cs_client_pending` · Day 0 (`+0h`) | Client invited → Invitation accepted | UTILITY | View project | Confirms the invite to their Homeowner was sent |
| `groundwork_cs14` | CS14 | `cs_client_pending` · Day 3 (`+72h`) | Client has not accepted yet | UTILITY | Review invitation | Reminds contractor to follow up or verify client contact |
| `groundwork_cs15` | CS15 | `cs_client_pending` · Day 4 (`+96h`) | Client has not accepted yet | UTILITY | Manage invitation | Offers Groundwork guidance to help the client join |
| `groundwork_cs16` | CS16 | `cs_connected` · Day 0 (`+0h`) | Client accepted invitation | UTILITY | Open project | Confirms Homeowner joined; ready to share site updates |

---

### Journey B — Contractor Invited by a Homeowner (`CI01–CI09`)
*Used for contractors invited onto an existing Homeowner project.*

| Template Name | Code | Sequence & Timing | Trigger → Exit Condition | Meta Category | Button | Staff Use Case |
|---|---|---|---|---|---|---|
| `groundwork_ci01` | CI01 | `ci_invited` · Day 0 (`+0h`) | Homeowner invites contractor → Invite accepted | UTILITY | Accept invitation | Initial invitation notice naming Homeowner + project |
| `groundwork_ci02` | CI02 | `ci_invited` · Day 1 (`+24h`) | Invite still pending | MARKETING | Accept invitation | 24h reminder that project invite is waiting |
| `groundwork_ci03` | CI03 | `ci_invited` · Day 2 (`+48h`) | Invite still pending | MARKETING | Join project | Explains shared workspace with the Homeowner |
| `groundwork_ci04` | CI04 | `ci_invited` · Day 4 (`+96h`) | Invite still pending | UTILITY | Accept invitation | **Final reminder:** asks them to reply if having access trouble |
| `groundwork_ci05` | CI05 | `ci_onboarding` · Day 0 (`+0h`) | Invite accepted (first-time contractor) → Onboarding complete | UTILITY | Complete onboarding | Explains they must finish onboarding (don't create new project) |
| `groundwork_ci06` | CI06 | `ci_onboarding` · Day 1 (`+24h`) | Onboarding still incomplete | UTILITY | Continue onboarding | 24h nudge to finish setup and enter the Homeowner's project |
| `groundwork_ci07` | CI07 | `ci_onboarding` · Day 2 (`+48h`) | Onboarding still incomplete | UTILITY | Finish onboarding | Confirms invite is accepted; resume setup via button |
| `groundwork_ci08` | CI08 | `ci_onboarding` · Day 4 (`+96h`) | Onboarding still incomplete | MARKETING | Complete setup | **Best for manual check-in:** invites reply if stuck in onboarding |
| `groundwork_ci09` | CI09 | `ci_connected_existing` / `ci_connected_new` · Day 0 | Connected to project | UTILITY | Open project | Confirms contractor is connected to Homeowner's project |

---

### Journey C — Homeowner Self-Signup (`CL01–CL13`)
*Used for Homeowners who signed up independently on Groundwork.*

| Template Name | Code | Sequence & Timing | Trigger → Exit Condition | Meta Category | Button | Staff Use Case |
|---|---|---|---|---|---|---|
| `groundwork_cl01` | CL01 | `cl_signup` · Day 0 (`+0h`) | Homeowner signs up → First project created | UTILITY | Create your first project | Welcome message after Homeowner signup |
| `groundwork_cl02` | CL02 | `cl_signup` · Day 1 (`+24h`) | No project created yet | UTILITY | Create project | 24h reminder to add their construction project |
| `groundwork_cl03` | CL03 | `cl_signup` · Day 2 (`+48h`) | No project created yet | UTILITY | Create project | Explains milestones, documents & contractor collaboration |
| `groundwork_cl04` | CL04 | `cl_signup` · Day 4 (`+96h`) | No project created yet | UTILITY | Create project | **Best for manual check-in:** offers team help entering project details |
| `groundwork_cl05` | CL05 | `cl_project` · Day 0 (`+0h`) | Project created → Contractor invited / support requested | MARKETING | Connect a contractor | Confirms project creation; prompts inviting/requesting contractor |
| `groundwork_cl06` | CL06 | `cl_project` · Day 1 (`+24h`) | No contractor connected yet | MARKETING | Connect a contractor | 24h reminder to invite contractor or request help |
| `groundwork_cl07` | CL07 | `cl_project` · Day 2 (`+48h`) | No contractor connected yet | MARKETING | Connect a contractor | Explains following stages & updates with a connected contractor |
| `groundwork_cl08` | CL08 | `cl_project` · Day 4 (`+96h`) | No contractor connected yet | MARKETING | Choose contractor option | **Best for manual check-in:** invite own contractor or request Jalla help |
| `groundwork_cl09` | CL09 | `cl_support` · Day 0 (`+0h`) | Contractor support requested → Resolved | UTILITY | View project | Confirms Jalla received their request for help finding a contractor |
| `groundwork_cl10` | CL10 | `cl_contractor_pending` · Day 0 (`+0h`) | Contractor invited → Invite accepted | UTILITY | View project | Confirms invitation to their contractor was sent |
| `groundwork_cl11` | CL11 | `cl_contractor_pending` · Day 3 (`+72h`) | Contractor has not joined yet | UTILITY | Review invitation | Reminds Homeowner to share the invite link directly |
| `groundwork_cl12` | CL12 | `cl_contractor_pending` · Day 4 (`+96h`) | Contractor has not joined yet | MARKETING | Manage invitation | Offers Groundwork guidance if contractor needs help joining |
| `groundwork_cl13` | CL13 | `cl_connected` · Day 0 (`+0h`) | Contractor accepted invitation | UTILITY | Open project | Confirms contractor joined the build |

---

### Journey D — Homeowner Invited by a Contractor (`IV01–IV05`)
*Used for Homeowners invited by their contractor to follow an existing build.*

| Template Name | Code | Sequence & Timing | Trigger → Exit Condition | Meta Category | Button | Staff Use Case |
|---|---|---|---|---|---|---|
| `groundwork_iv01` | IV01 | `iv_invited` · Day 0 (`+0h`) | Contractor invites Homeowner → Invite accepted | MARKETING | Accept invitation | Initial invite notice naming contractor + project *(see Section 3 grammar fix)* |
| `groundwork_iv02` | IV02 | `iv_invited` · Day 1 (`+24h`) | Invite still pending | MARKETING | Accept invitation | 24h reminder to connect with contractor on project |
| `groundwork_iv03` | IV03 | `iv_invited` · Day 2 (`+48h`) | Invite still pending | UTILITY | Join project | Explains shared access to milestones, docs & updates |
| `groundwork_iv04` | IV04 | `iv_invited` · Day 4 (`+96h`) | Invite still pending | UTILITY | Accept invitation | **Final reminder:** asks them to reply if needing access help |
| `groundwork_iv05` | IV05 | `iv_connected` · Day 0 (`+0h`) | Homeowner accepted invitation | UTILITY | Open project | Confirms Homeowner is connected (don't create duplicate project) |

---

## 3. Why English Templates Get Declined (While French Passes) & Compliant Rewrites

Meta's automated English review classifier is **substantially stricter** than its French classifier on three exact rules:

1. **Promotional / Social-Proof Claims Inside Utility Templates**
   - Meta rejects or reclassifies any `UTILITY` template that pitches benefits, outcomes, or referrals rather than stating an account/project fact.
   - **Flagged culprit — `groundwork_cs12` (`en`)**:
     > *Current:* `P.S: Contractor using Groundwork to provide updates report higher client satisfaction and referrals`  
     > **Problem:** Combines a promotional claim (*"higher client satisfaction and referrals"*) with a grammar error (*"Contractor ... report"*) and missing punctuation.
2. **Grammar Errors & Awkward Framing in English**
   - Meta's quality check flags missing articles and subject-verb mismatches:
     - **`groundwork_cs09` (`en`)**: `"You control what your client see."` → should be `"You control what your client sees."`
     - **`groundwork_iv01` (`en`)**: `"create your account to view project."` → should be `"create your account to view the project."`
3. **Dangling Variables at Start/End of Body (Error `100 / 2388299`)**
   - Already fixed in `shared/whatsapp.ts` (`channelBody()`), which automatically appends `"Open Groundwork to continue."` / `"Ouvrez Groundwork pour continuer."` whenever a body ends with `{{variable}}.` (affecting `ci06`, `ci08` in EN and `ci05`, `ci06`, `ci07`, `ci09` in FR).
4. **Why 12 Template Names Were Reclassified to `MARKETING`**
   - Meta moved `cl05`, `cl06`, `cl07`, `cl08`, `cl12`, `cs01`, `cs02`, `cs08`, `cs10`, `cs11`, `ci02`, `ci03`, `ci08`, `iv01`, `iv02` from `UTILITY` → `MARKETING` because phrases like *"Congratulations on creating..."*, *"Welcome to Groundwork..."*, *"creates a shared source of truth"*, and *"is waiting"* read as onboarding re-engagement rather than pure transactional status updates.
   - **Important:** `MARKETING` templates **still deliver normally** once approved (just billed at Meta's Marketing conversation rate rather than Utility rate). Do **not** resubmit a `MARKETING`-assigned name as `UTILITY` without first removing promotional language and requesting a category appeal in WhatsApp Manager.

### Recommended Meta-Compliant English Rewrites

#### 1. `groundwork_cs12` (`en`) — Remove promotional P.S. + fix grammar
```text
Hi {{1}},

Your project is not connected to a Homeowner yet. If you need help sending the invitation or getting them set up on Groundwork, reply to this message and our team will assist.
```

#### 2. `groundwork_cs09` (`en`) — Fix grammar + keep transactional tone
```text
Hi {{1}},

{{2}} has been created in Groundwork.

Your next step is to invite the Homeowner. Once connected, they can view the project details, milestones, documents, and updates you share. You control what is shared.
```

#### 3. `groundwork_iv01` (`en`) — Fix missing article (`the project`)
```text
Hi {{1}},

{{2}} has invited you to join {{3}} on Groundwork by Jalla.

Accept the invitation to view the project details, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view the project.
```

---

## 4. Step-by-Step SOP: Fixing a Declined Template in Meta

1. **Check the exact rejection reason in Meta Business Suite:**
   - Open **Meta Business Suite → WhatsApp Manager → Account tools → Message templates** (WABA ID `1087160260359893`).
   - Filter by **Status: Rejected** and open the declined English template to confirm Meta's exact rejection code (`INVALID_FORMAT`, `PROMOTIONAL_CONTENT`, `ABUSIVE_CONTENT`, or `TAG_CONTENT_MISMATCH`).
2. **Update the wording in Groundwork FIRST** (so Groundwork's compiled definition matches Meta byte-for-byte):
   - Go to **Admin → Sequences** (`/admin/sequences`), open the matching step (e.g. `CS12`, `CS09`, or `IV01`), update the English body with the compliant text from Section 3, and save.
3. **Update & resubmit the template in Meta WhatsApp Manager:**
   - Edit the rejected English template with the exact compiled text (including the footer `Reply STOP to stop reminders.` and the URL button `https://www.tryjalla.com/{{1}}`).
   - Keep the category Meta expects (`UTILITY` for transactional updates, or `MARKETING` if the French sibling is already approved under `MARKETING` — Meta requires all languages of the same template name to share one category).
   - Submit for review (typical Meta turnaround: 5 minutes – 2 hours).
4. **Refresh approval status inside Groundwork:**
   - Open **Admin → Inbox → WhatsApp → Connection settings** (or **Admin → Sequences → WhatsApp**) and click **Check connection** / refresh templates.
   - Confirm the template now shows **APPROVED** in **Templates** tab before sending.

---

## 5. Quick Cheat Sheet: Best Templates for Manual Staff Follow-Ups

| Situation (24h Window Closed) | English / French Template to Pick |
|---|---|
| Contractor signed up, stuck in onboarding | `groundwork_cs04` |
| Contractor finished onboarding, hasn't added a project | `groundwork_cs08` |
| Contractor created project, hasn't invited Homeowner | `groundwork_cs12` |
| Contractor invited Homeowner, Homeowner hasn't joined | `groundwork_cs15` |
| Invited contractor hasn't accepted Homeowner's invite | `groundwork_ci04` |
| Invited contractor accepted invite, stuck in onboarding | `groundwork_ci08` |
| Homeowner signed up, hasn't created a project | `groundwork_cl04` |
| Homeowner created project, hasn't connected a contractor | `groundwork_cl08` |
| Homeowner invited contractor, contractor hasn't joined | `groundwork_cl12` |
| Invited Homeowner hasn't accepted contractor's invite | `groundwork_iv04` |
