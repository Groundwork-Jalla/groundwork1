# Groundwork — Route & Surface Directory

*Updated: 20 Nov 2026 · Source of truth: [`src/app/routes.ts`](../src/app/routes.ts) (**91 routes**)*

Groundwork by Jalla (`https://www.tryjalla.com`) is a bilingual (EN/FR) React 19 + TypeScript + React Router v7 + Tailwind CSS v4 + Supabase + Vercel Pro application. Every user-facing string lives in `src/lib/i18n/en.ts` and `src/lib/i18n/fr.ts` (`Mirror<EnDict>`).

---

## Shells & Layouts

| Layout | Shell Component | Audience |
|---|---|---|
| `_public-layout.tsx` | `SiteNav` + `SiteFooter` | Signed-out marketing, legal, public verification |
| `_auth-layout.tsx` | Architectural auth frame | Login, signup, role doors, password reset, invite/share acceptance |
| `projects/new.tsx` | `WizardShell` (full-screen) | Project creation wizard (Homeowner & Contractor) |
| `_layout.tsx` | `AppShell` + `AppSidebar` | Signed-in Homeowner portal |
| `work/_layout.tsx` | `WorkShell` | Signed-in Contractor execution portal |
| `verifiers/_layout.tsx` | Verifier shell | Signed-in Independent Verifier portal |
| `admin/_admin-layout.tsx` | `AppShell` + Admin sidebar | Staff / Admin back-office (`is_admin()`) |
| `tools/_tools-layout.tsx` | `SiteNav` + `SiteFooter` | Free public planning calculators (no auth) |

---

## 1. Public & Utility Routes (8)

| Path | File | Purpose |
|---|---|---|
| `/communication/preferences/:token` | `routes/communication-preferences.tsx` | Recipient email reminder preference & opt-out confirmation |
| `/` | `routes/landing.tsx` | Public landing page |
| `/contractor-apply` | `routes/contractor-apply.tsx` | Native bilingual contractor partner application (`ContractorApplicationForm`) |
| `/jalla-management` | `routes/jalla-management.tsx` | Jalla Management consultation & questionnaire intake |
| `/verify/:id` | `routes/verify.tsx` | Public stage completion certificate verification |
| `/privacy` | `routes/privacy.tsx` | Privacy policy (lists sub-processors) |
| `/terms` | `routes/terms.tsx` | Terms of service |
| `/partner-agreement` | `routes/partner-agreement.tsx` | Public readable copy of the contractor partner agreement |

---

## 2. Auth, Onboarding & Invitation Routes (11)

| Path | File | Purpose |
|---|---|---|
| `/auth/login` | `routes/auth/login.tsx` | Email/password + Google OAuth + MFA sign-in |
| `/auth/signup` | `routes/auth/signup.tsx` | Account creation with Homeowner / Contractor role selector |
| `/auth/reset-password` | `routes/auth/reset-password.tsx` | Request password reset email |
| `/auth/new-password` | `routes/auth/new-password.tsx` | Complete password reset / first-time password setup |
| `/auth/callback` | `routes/auth/callback.tsx` | OAuth/email confirmation callback + contractor role grant |
| `/onboarding` | `routes/onboarding.tsx` | Post-signup Homeowner orientation |
| `/invite/:token` | `routes/invite.tsx` | Contractor project invitation acceptance |
| `/claim/:token` | `routes/claim.tsx` | Approved applicant claiming contractor account |
| `/contractor-signup` | `routes/contractor-signup.tsx` | Dedicated contractor signup door |
| `/verifier-signup` | `routes/verifier-signup.tsx` | Dedicated invited verifier signup door |
| `/share/:token` | `routes/share.tsx` | Homeowner / family / observer project share-link acceptance |

---

## 3. Project Creation Wizard (1)

| Path | File | Purpose |
|---|---|---|
| `/projects/new` | `routes/projects/new.tsx` | Multi-step build estimator & project setup: country → city (for supported countries) → project/building/roof details → mid-build stage & contractor-recorded upfront payment + currency selection → optional BOQ/plan question → budget confirmation (`Step11ConfirmBudget`). No project cap (`167_no_project_creation_cap.sql`). |

---

## 4. Homeowner Client Portal (`_layout.tsx`, 13 routes)

Sidebar destinations (defined in `src/components/shell/nav-config.ts`): Dashboard, Projects, Documents, Resources, Profile, Help.

| Path | File | Purpose |
|---|---|---|
| `/dashboard` | `routes/dashboard.tsx` | Calm Homeowner overview, active project next action, financial summary |
| `/projects` | `routes/projects/index.tsx` | All projects list |
| `/projects/:id` | `routes/projects/detail.tsx` | 7-tab project workspace: **Overview**, **Stages** (substages, evidence review, `StageBreakdownPanel`, `StagePaymentGate`, `StagePaymentPlanPanel`, `ProjectCloseoutPanel`), **Costing** (`StagePricingPanel`, `ProjectPaymentHistory`, `BudgetView`), **Team** (`ProjectTeam`, `ProjectSharing`, `ContractorInvite`), **Timeline**, **Documents** (`ClientDocuments` + Payment History), **Messages** (`ProjectConversations`) |
| `/projects/:id/takeoff` | `routes/projects/takeoff.tsx` | BOQ / quantity take-off list |
| `/projects/:id/takeoff/:takeoffId` | `routes/projects/takeoff.detail.tsx` | Editable BOQ detail grid |
| `/documents` | `routes/documents.tsx` | Cross-project document library |
| `/resources` | `routes/resources.tsx` | 16 construction planning guides (`mailto:contact@tryjalla.com`) |
| `/resources/:slug` | `routes/resources.detail.tsx` | Individual resource article |
| `/contractors` | `routes/contractors.tsx` | Contractor directory (locked to staff since `20261109000000_free_access_and_locked_directory.sql`; hidden from client sidebar) |
| `/messages` | `routes/messages.tsx` | Cross-project conversation inbox |
| `/notifications` | `routes/notifications.tsx` | Unread / earlier notification feed |
| `/profile` | `routes/profile.tsx` | Profile, Account/2FA (TOTP + email MFA), Team, Notifications, Danger zone (Subscription tab removed) |
| `/help` | `routes/help.tsx` | Homeowner FAQ & support form |

---

## 5. Free Public Planning Tools (`tools/_tools-layout.tsx`, 5 routes)

| Path | File | Purpose |
|---|---|---|
| `/tools` | `routes/tools/index.tsx` | Tools hub |
| `/tools/budget` | `routes/tools/budget.tsx` | Construction budget calculator |
| `/tools/stages` | `routes/tools/stages.tsx` | Stage-by-stage cost breakdown |
| `/tools/milestones` | `routes/tools/milestones.tsx` | Milestone payment planner |
| `/tools/tracker` | `routes/tools/tracker.tsx` | Standalone build tracker preview |

---

## 6. Contractor Execution Portal (`work/_layout.tsx`, 11 routes)

| Path | File | Purpose |
|---|---|---|
| `/work` | `routes/work/index.tsx` | Contractor dashboard, open stages, partner activation tracker (3 steps: applied → qualified → book call = 100%) |
| `/work/projects` | `routes/work/projects.tsx` | Assigned & contractor-created projects |
| `/work/projects/:projectId` | `routes/work/projects.detail.tsx` | Work tab (evidence upload, `ContractorPaymentVerificationBar`, `StageBreakdownPanel`, `StagePaymentGate`, substage payment requests, automatic overpayment carryover), Documents, Money (`StagePricingPanel`, `ProjectPaymentHistory`), People, Messages |
| `/work/projects/:id/takeoff` | `routes/work/projects.takeoff.tsx` | Contractor BOQ list |
| `/work/projects/:id/takeoff/:takeoffId` | `routes/work/projects.takeoff.detail.tsx` | Contractor BOQ editor |
| `/work/payouts` | `routes/work/payouts.tsx` | Contractor payout account details & transfer history |
| `/work/onboarding` | `routes/work/onboarding.tsx` | Unified contractor onboarding (identity, professional, payout, emergency, partner agreement) |
| `/work/partner` | `routes/work/partner.tsx` | Partner network application & call booking |
| `/work/profile` | `routes/work/profile.tsx` | Contractor profile & WhatsApp contact consent |
| `/work/help` | `routes/work/help.tsx` | Contractor-scoped help & FAQ |
| `/work/clients/new` | `routes/work/clients.new.tsx` | Partner contractor onboarding a Homeowner & creating their project |

---

## 7. Independent Verifier Portal (`verifiers/_layout.tsx`, 4 routes)

| Path | File | Purpose |
|---|---|---|
| `/verifiers` | `routes/verifiers/index.tsx` | Assigned site verification queue |
| `/verifiers/:id` | `routes/verifiers/detail.tsx` | Verification checklist & decision submission |
| `/verifiers/projects/:projectId` | `routes/verifiers/projects.detail.tsx` | Project view & messaging for assigned verifier |
| `/verifiers/settings` | `routes/verifiers/settings.tsx` | Verifier profile & settings |

---

## 8. Admin Back-Office (`/admin/login` + `admin/_admin-layout.tsx`, 38 routes)

| Group | Routes |
|---|---|
| **Auth** | `/admin/login` |
| **Operations** | `/admin` (Overview + grouped Recent Activity), `/admin/action-center` (includes payment disputes & overpayment alerts), `/admin/projects`, `/admin/projects/new`, `/admin/projects/:id` (7-tab Project Workspace), `/admin/projects/:id/takeoff(/:takeoffId)`, `/admin/reviews`, `/admin/site-updates`, `/admin/budgets` |
| **Finance** | `/admin/finance` (per-project split overview), `/admin/finance/inflows`, `/admin/finance/disbursements` |
| **People** | `/admin/users`, `/admin/users/new`, `/admin/clients`, `/admin/contractors`, `/admin/contractors/records`, `/admin/partners`, `/admin/verifiers`, `/admin/team` |
| **Growth & Intake** | `/admin/applications`, `/admin/applications/:id`, `/admin/drafts`, `/admin/waitlist`, `/admin/inquiries`, `/admin/requests` |
| **Communications** | `/admin/inbox`, `/admin/sequences` (Email journeys, Tracking, Inbox, WhatsApp, Settings, Held/Suppressed diagnostics), `/admin/notifications`, `/admin/support` |
| **Platform** | `/admin/crm`, `/admin/integrations`, `/admin/analytics`, `/admin/audit-log`, `/admin/settings` |
| **Placeholders** | `/admin/:section` → `placeholder.tsx` (`inspections`, `tasks`, `site-managers`, `agents`) |

---

## Retired / Unrouted Legacy Files (Not in `src/app/routes.ts`)

- Removed routes: `/pricing`, `/community`, `/payments`, `/upgrade`.
- Unreferenced legacy files still on disk pending cleanup: `src/app/routes/payments.tsx`, `src/app/routes/upgrade.tsx`, `src/lib/i18n/external-forms.ts`, `src/components/wizard/steps/Step10PlanSelection.tsx`, `src/components/project/ProjectPayments.tsx`, `src/components/project/ProjectPaymentsLedger.tsx`.
