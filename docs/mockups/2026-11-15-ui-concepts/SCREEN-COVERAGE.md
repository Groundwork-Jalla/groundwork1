# Client and Admin UI design coverage — 15 November 2026

Checked against `src/app/routes.ts`, the client project's tab definitions, the Admin workspace tabs, communications components and shell navigation.

**The preview set is not a complete screen inventory.** The current home selection is **01 — Calm & clear**, with a quiet overview replacing the intermediate 02 implementation. **03 — Stages/payment** and **06 — Confirmations** remain approved. Several boards contain multiple example screens or dialogs. A page appearing in the navigation or an overview table does not mean its full design has been produced.

The three approved client areas are implemented locally; [IMPLEMENTATION.md](IMPLEMENTATION.md) records the scope, screenshots and checks. Remaining entries below describe **design coverage**, independently of whether their existing application functionality exists. Controlled local checks do not replace live acceptance testing.

## Previews already produced

| Board | What is covered |
| --- | --- |
| 01 | Selected client dashboard: white sidebar, project/photo card, one next action and compact financial summary. |
| 02 | Intermediate architectural home direction, retained as an alternative. |
| 03 | Client stage view after work approval, with partial-payment balance and receipt controls. |
| 04 | Admin overview, sample attention queue, project-list preview and communication setup summary. |
| 05 | Client mobile: empty account, contractor-origin evidence review, client-origin funding and a submitted receipt awaiting contractor confirmation. |
| 06 | Final-update confirmation for a contractor-created project and client confirmation of a proposed price change. |
| 07 | Admin email conversation with follow-up context and setup status. |

## Client: full remaining screen coverage

| Area / existing destination | Current coverage | Designs still needed |
| --- | --- | --- |
| Home — `/dashboard` | Calm overview implemented with existing owned/joined projects, collapsed other-project links, next-action gates, loading/retry and observer handling. | Further dedicated design review of empty, multiple-project, observer and unavailable-data variants. Existing behavior remains accessible. |
| My projects — `/projects` | Sidebar destination only. | Full project list, owned/shared distinctions, search/filters, empty/loading/error states. |
| Create project — `/projects/new` | Empty-account CTA only. | Actual wizard branches for estimate/BOQ, project details, plan/document review, total confirmation, current-stage selection, creation success and recoverable errors. Preserve all conditional steps in the existing wizard. |
| Project overview — `/projects/:id?tab=overview` | Header/summary motifs only. | Full project overview, current participants, meaningful next step, historical/mid-build context and paused/completed states. |
| Stages — `?tab=stages` | Responsive client layout implemented for all ten stages, retained historical/zero allocations, evidence/lightbox, approvals and read-only gates. | Additional design boards for paused/completed, incomplete-evidence and correction scenarios; live acceptance across both project origins. |
| Payments and history — existing project payment surfaces | Client presentation implemented over existing full/two-installment, multiple-proof, confirmed/pending balance, replacement and validation behavior. | Dedicated design review of less common receipt-decision and service-error states. A new global Payments route is not assumed. |
| Budget and prices — `?tab=costing` | Client price-approval confirmation shown. | Full current/proposed comparison, unchanged/retained/rejected proposals, approved history, revision impact on balances and source/date context for conversions. |
| Timeline — `?tab=timeline` | Not shown. | Full stage timeline, completed-before-tracking, current/future stages and narrow-screen layout. |
| Project documents — `?tab=documents` | Shortcut/gallery motifs only. | Full list, categories, file detail and authorized upload/download actions. |
| Global documents — `/documents` | Shortcut only. | Cross-project library, filters and file viewer for images, PDFs and spreadsheets; unavailable/unsupported-file states. |
| Project messages — `?tab=messages` | Shortcut only. | Conversation layout, composer where authorized, attachments/delivery states, empty/loading/error states and mobile. |
| Team — `?tab=team` | Shortcut and Invite button only. | Full participants, primary roles, observer/family labels, pending/revoked invitations and participant permissions. |
| Sharing and invitations — project dialogs, `/invite/:token`, `/share/:token` | Not shown as complete screens. | Role dropdown before link generation, role-specific link/email sharing, copy result, first claim, existing/new-account continuation, already-used/invalid/revoked link states. Links have no expiration. |
| Notifications — bell and `/notifications` | Bell appearance only. | Dropdown, full list, read/unread, empty/loading/error states and action-destination presentation. |
| Profile/settings — `/profile` | Sidebar destination only. | Existing profile/account controls, preferences, security and save/error states. |
| Resources — `/resources`, `/resources/:slug` | Sidebar destination only. | Library, guide detail, navigation back and mobile reading. |
| Help — `/help` | Sidebar destination only. | Existing help/contact/support journey and submission feedback. |
| Take-off/BOQ compatibility — `/projects/:id/takeoff`, `/projects/:id/takeoff/:takeoffId` | Not shown. | Apply the selected client shell where this shared route is legitimately available; preserve role-specific read/edit behavior and return navigation. This is not a request to redesign contractor execution. |
| Older reachable client routes — `/contractors`, `/messages` | Not shown. | Preserve valid bookmarked/email destinations and appropriate shell styling; do not restore removed sidebar entries without a separate decision. |

## Shared entry and account screens

These sit outside the client/Admin dashboards but are part of a complete journey:

- Client signup/login, onboarding, email verification/callback feedback, password reset and new password.
- Invitation acceptance and return to the correct existing project/account role.
- Staff sign-in at `/admin/login`.
- Communication preferences and opt-out confirmation at `/communication/preferences/:token`.
- Session expiration, access denied and recoverable navigation/error states.

Contractor and verifier execution workspaces are not added to this visual refresh. Their existing invitation/auth continuation must still work.

## Admin: full remaining screen coverage

| Area / existing destination | Current coverage | Designs still needed |
| --- | --- | --- |
| Overview — `/admin` | Representative full overview shown. | Responsive/empty/unavailable states and exact mapping to existing data/modules. |
| Action Center — `/admin/action-center` | Preview rows on overview only. | Full queue, category/owner/due filters, item context, destinations and empty/error states. |
| Projects — `/admin/projects`, `/admin/projects/new` | Small overview table only. | Full list, current filters/search, creation workflow, matching records and mobile. |
| Project workspace — `/admin/projects/:id` | Not shown. | All eight existing tabs: overview, stages, financials, site updates, documents, conversations, activity and team; stage/conversation selection and correct return links. Preserve oversight/participant-role boundaries. |
| Take-offs — `/admin/projects/:id/takeoff[/takeoffId]` | Not shown. | Existing take-off list/detail and related document/financial context. |
| Users — `/admin/users`, `/admin/users/new` | Sidebar entry only. | List, account/profile review, four-role correction, owned-project repair/conflict review, creation, deletion and confirmation states. |
| People — clients, contractors, contractor records, verifiers, partner pipeline | Sidebar entries only. | Existing full records, onboarding/contact details, filters, assignments and account/project context. |
| Reviews and site updates — `/admin/reviews`, `/admin/site-updates` | Navigation/queue motifs only. | Full existing queues and evidence/document inspection, with current Admin permissions preserved. |
| Finance — overview, inflows, disbursements, budgets/fees | Collapsed navigation group only. | All current lists, details and existing review/confirmation controls. Do not invent live provider transactions or participant payment confirmations. |
| Applications — list/detail, drafts, waitlist | Overview queue entry only. | Full applications, detail/decision screens, started applications and waitlist management. |
| Acquisition/CRM — inquiries and CRM | Not shown. | Existing quote/enquiry records, lead context, filtering and follow-up. |
| Main inbox — `/admin/inbox` and channel filters | Representative email conversation in communication concept. | Exact existing multi-channel entry points, full conversation states, unread/attachment behavior and channel-specific restrictions. |
| Lifecycle communications — `/admin/sequences` | One email thread and follow-up context shown. | Full attention queue, journeys, sequence editor, tracking/recovery, send log, settings, contact history and operational error states. |
| WhatsApp — existing communication tools | Setup status only. | Connection settings, test audience, consent, templates, inbox/replies, delivery errors and verified callback state. Keep actual provider readiness independent from the design. |
| Support — `/admin/support` | Not shown. | Full support list, case context and existing staff actions. |
| Analytics and audit log | Small activity motif only. | Actual reports/filtering, time ranges, audit details and unavailable-data handling. |
| System — integrations, automation requests, staff/team permissions and settings | Collapsed navigation only. | Existing configuration forms, write-only secrets, role/access controls, confirmation and save/error states. |
| Admin notifications — bell and `/admin/notifications` | Bell appearance only. | Full list/dropdown and actionable navigation states. |

## Existing placeholders, not finished modules

The route/navigation map explicitly marks **Inspections, Tasks, Site managers and Agents** as placeholders. A complete visual pass should style their honest empty pages. It must not silently treat them as functioning modules or expand the release into building them.

## Shared states that still need a consistent treatment

Across the relevant existing screens: responsive phone/tablet/desktop; keyboard focus and accessible dialogs; loading; empty; failed/unavailable data; validation; saving and double-submit prevention; success; read-only; paused/locked; lost access/session; and text wrapping for long names, amounts and French copy.

The generated previews demonstrate a subset of these states. They do not prove interaction behavior, accessibility or production readiness.

## Recommended design completion order

The user reconfirmed the remaining client design groups:

- Project list and the complete project-creation/BOQ wizard.
- Full project overview, budget, timeline and payment history.
- Documents, file viewers and project messages.
- Team, role selection, sharing links and invitation acceptance.
- Notification list/bell presentation, profile, settings, resources and help.

These are design-review items. Their existing application behavior stays in place until a corresponding replacement design is approved.

1. Complete the client journey: project list and wizard, project overview and all tabs, sharing/entry, documents/messages, notifications and account/help.
2. Complete the Admin project and people workspaces, including role correction.
3. Complete communication/settings, finance, acquisition/support and reporting surfaces.
4. Review shared states and responsive behavior across both surfaces.

Use a small family of coherent templates for lists, details, forms, conversations and confirmations. A complete design specification does not require a wholly different visual style for each URL. Existing functions and routes remain the source of behavior.

