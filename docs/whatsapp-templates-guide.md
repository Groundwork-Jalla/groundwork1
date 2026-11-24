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

## 3. Quick Cheat Sheet: Best Templates for Manual Staff Follow-Ups

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
