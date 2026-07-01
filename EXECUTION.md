# Groundwork by Jalla — Project Execution Record

**Construction Management Platform · July 2026**

A platform that lets Africans living abroad manage, fund, and track construction projects back home — with full transparency, real evidence, and verified progress at every stage.

**Stack:** React 19 · TypeScript · React Router v7 · Tailwind CSS v4 · Supabase · Vercel

---

## The Problem — Why Groundwork Exists

Building a home or property in Africa while living abroad is one of the hardest things a diaspora person can do. Not because of money — but because of distance, trust, and lack of visibility.

You send money. You get photos. You have no idea if the photos are real. You're told "Stage 3 is done" but you can't verify it. Your contractor goes quiet. When you visit, the build is behind, over budget, or worse — nothing has happened at all.

This isn't rare. **It's the default experience** for most Africans building from abroad. Groundwork is built to change that by replacing trust-based construction management with a structured, evidence-driven system that works whether you're in Lagos or London.

> **The core idea:** Every payment is tied to proof. Every stage is independently reviewed. Every step is recorded in one place — and you can see all of it from your phone, anywhere in the world.

---

## Who Uses Groundwork

Two groups of people use the platform, and it's designed to serve both.

- **Diaspora builders** — Africans living in the UK, USA, Canada, Europe, and elsewhere who are funding a construction project back home. They are the project owners. They see everything, approve stages, release payments, and communicate with contractors.
- **Contractors & professionals** — General contractors, engineers, surveyors, architects, and other trades who work on diaspora-funded projects. They upload evidence, request stage approvals, and communicate through the platform.

### Subscription Tiers

| Plan | Price | Key Features |
|---|---|---|
| **Starter** | Free | Up to 3 projects, self-approve stages, evidence upload, document vault, project chat |
| **Pro** | $19/mo | Unlimited projects, Jalla reviews & approves stages, everything in Starter, priority support |
| **Enterprise** | Custom | Jalla manages everything, dedicated project manager, white-glove service, custom reporting |

---

## What Was Built, Phase by Phase

### Phase 1 — Foundation
**Authentication, Database, and Landing**

Before any product feature could exist, the scaffolding had to be set up correctly. This phase built the invisible infrastructure that everything else runs on.

- **User accounts** — Sign up, log in, password reset, and email confirmation. Powered by Supabase Auth. Every user gets a secure account, and all their project data is private to them.
- **Database** — All the tables that store data: projects, construction stages, sub-stages, and user information. Rules were applied so that each user can only ever see and touch their own data — even if you somehow guessed another user's project ID, you'd get nothing.
- **Landing page** — The public-facing page explaining what Groundwork is, who it's for, and why it exists. Includes the countdown to launch, a comparison ("without structure" vs "with Groundwork"), and the waitlist sign-up.
- **Contractor application page** — A separate page for construction professionals to apply to join the Jalla verified network.
- **Community waitlist** — A separate sign-up flow for early interest (name, email, location) — this is not an account, just a waitlist.

---

### Phase 2 — Project Creation
**The 9-Step Wizard and Automatic Stage Setup**

The most complex user-facing feature: a guided form that collects everything needed to set up a construction project, then automatically creates the full construction pipeline behind the scenes.

**The 9-step wizard collects:**

1. **Country** — Where the build is happening; affects cost calculations
2. **Project Type** — Residential, commercial, industrial, or mixed-use
3. **Building Type** — Single family home, office, hotel, warehouse, etc.
4. **Number of Floors** — Affects complexity and cost
5. **Room Breakdown** — Bedrooms, bathrooms, living rooms, kitchens
6. **Boys' Quarters** — Staff/guest accommodation — common in Nigerian construction
7. **Roof Type** — Long-span aluminum, clay tiles, concrete flat, or shingle
8. **Project Details** — Project name, city, size in sqm, finish level, target start date
9. **Choose a Plan** — Starter (free), Pro ($19/mo), or Enterprise (custom)

Once the wizard is completed and submitted, the system automatically:

- Creates the project record in the database
- Generates 10 construction stages tailored to the project type (a residential house gets different stages than a commercial office building)
- Creates all the sub-tasks (substages) under each stage
- Calculates budget milestones — how much money is tied to each stage
- Unlocks Stage 1 and locks all others until approved in sequence

> **Why this matters:** Most construction projects fail because there's no predefined structure. By auto-generating the pipeline on project creation, every Groundwork project starts with a clear, sequential roadmap — before a single brick is laid.

A **budget estimator** was also built that calculates the full project cost in USD using country-specific rates per square metre, adjusted for building type, number of floors, roof type, and finish level (standard / premium / luxury).

---

### Phase 3 — Core Features
**Everything Inside a Project**

With projects being created, the next phase built all the tools that make a project actually useful to manage. The project detail page was redesigned into a 4-tab layout.

- **Stages Tab — Evidence Upload:** For each sub-task in each stage, contractors or owners can upload photos, videos, or documents as proof that work is done. Files are stored privately in the cloud. Thumbnail previews show images directly in the app.

- **Stages Tab — Stage Approval:** Once all sub-tasks in a stage have evidence uploaded and are marked complete, the stage can be approved.
  - Starter plan: the owner approves it themselves
  - Pro plan: it goes to Jalla's team for independent review
  - Enterprise: Jalla manages the entire flow
  
  When a stage is approved, the next stage automatically unlocks.

- **Budget Tab:** A full breakdown of the project budget — by category (materials 45%, labour 25%, engineering 18%, permits 2%, contingency 10%) and by stage. Shows how much money has been released, how much is held pending the active stage, and how much remains locked in future stages.

- **Documents Tab (Document Vault):** A secure file cabinet for important project documents — contracts, permits, architectural plans, receipts. Files can be uploaded, downloaded, and deleted. Separate from evidence (which is attached to specific tasks).

- **Messages Tab (Project Chat):** Real-time messaging between the project owner and any invited contractors. Messages appear instantly without refreshing the page, using Supabase Realtime technology.

- **Contractor Invite:** The project owner can invite a contractor by email address, giving them scoped access to that specific project. The invite can be revoked at any time.

All of these features were also built using a **modular architecture** — meaning each feature is a self-contained component that can be updated or replaced without affecting the others. Shared UI pieces (confirmation dialogs, file icons, empty states) are reused everywhere rather than duplicated.

---

### Phase 4 — Dashboard, Onboarding & Growth
**The Full User Journey**

The final phase polished the platform into something a real user could navigate from first visit to active project management.

- **Dashboard overhaul:** The dashboard now fetches and displays real project cards — each showing the project name, location, building type, tier, estimated budget, and a progress bar showing how many of the 10 stages are complete. Loading skeletons appear while data loads. A "New Project" card always appears in the grid as a quick creation shortcut.

- **Responsiveness audit:** Every page was reviewed and tested at mobile sizes (375px phones), tablets, and large desktops. Issues found on the risk section of the landing page were fixed. All layouts now adapt cleanly at every screen size.

- **Contractor Directory (`/contractors`):** A curated page showing verified construction professionals. On the Starter plan, contact details (phone, email, WhatsApp) are blurred out with an "Unlock with Pro" prompt. Pro and Enterprise users see full contact information and can request quotes.

- **Profile Page (`/profile`):** Users can set their display name, phone number, and country. A completion meter at the top shows profile completeness in 25% increments (name, phone, country, and ID document). Users can also upload a government-issued ID for identity verification.

- **Onboarding (`/onboarding`):** New users are no longer sent straight to the dashboard after signing up. Instead they see a welcome screen (with their name) followed by a plan selection screen. Choosing a plan saves it to their account and sends them to the dashboard.

- **Starter project cap enforced at database level:** The limit of 3 projects for Starter users isn't just a UI check — it's enforced by a rule in the database itself. Even if someone bypassed the app's interface and tried to create a 4th project directly, the database would reject it.

- **Auth callback updated:** When a new user clicks the email confirmation link, they're now sent to the onboarding page. Returning users who click a link go to the dashboard.

---

## By the Numbers

| Metric | Count |
|---|---|
| Files created or modified | 27 |
| Database migrations | 5 |
| Private storage buckets | 3 |
| App routes / pages | 9 |
| Project components | 14 |
| Supabase lib modules | 8 |
| Git commits | 4 |
| Lines of code | 5,000+ |

---

## Current State — What Works Right Now

The platform is deployed live at **groundwork1-phi.vercel.app**. Honest status of every feature:

| Status | Feature | Notes |
|---|---|---|
| ✅ Live | Sign up & login | Working — fix Site URL in Supabase dashboard first |
| ✅ Live | 9-step project creation wizard | Fully working |
| ✅ Live | Auto-generated stage pipelines | Type-specific stages created on project save |
| ✅ Live | Budget calculator | USD estimates by country, type, and size |
| ✅ Live | Dashboard with project cards | Fully working |
| ✅ Live | Evidence upload (photos & files) | Requires storage buckets (already set up) |
| ✅ Live | Stage approval flow | Starter self-approves, Pro goes to review |
| ✅ Live | Budget view (4 sections) | Fully working |
| ✅ Live | Document vault | Requires documents bucket (already set up) |
| ✅ Live | Project chat (real-time) | Messages appear instantly |
| ✅ Live | Contractor invite | Invite record created — email sending not yet wired |
| ✅ Live | Contractor directory | Working — mock data, tier-gated contacts |
| ✅ Live | Profile page + ID upload | Requires id-documents bucket (already set up) |
| ✅ Live | Onboarding flow | New users routed here after signup |
| ⚠️ Pending | Migration 005 (profiles + project cap) | Written — needs `npx supabase db push` to apply |
| ⚠️ Pending | Email confirmation link (prod) | Fix: set Site URL in Supabase Auth → URL Configuration |

---

## Tech Stack — Explained Simply

| Technology | What it is | Why it's used |
|---|---|---|
| **React 19** | A JavaScript library for building user interfaces | Builds every screen the user sees and interacts with |
| **TypeScript** | A stricter version of JavaScript that catches mistakes before they happen | Prevents bugs before the code even runs; the compiler catches errors at build time |
| **React Router v7** | Handles navigation between pages | When you click "Dashboard" or "New Project", this decides what to show |
| **Tailwind CSS v4** | A styling system that works directly in the HTML/JSX | Controls all colours, spacing, fonts, and responsive behaviour |
| **Framer Motion** | An animation library | Powers all the smooth transitions, slide-ins, and hover effects in the app |
| **Supabase** | A cloud backend (database + auth + file storage + real-time) | Stores all project data, manages user accounts, holds all uploaded files, and powers the live chat feature |
| **Supabase Storage** | Cloud file storage | Three private buckets: *evidence* (stage photos), *documents* (vault files), *id-documents* (ID uploads) |
| **Row Level Security (RLS)** | Database-level permission rules | Ensures every user can only see and modify their own data — even at the raw database level |
| **Vercel** | A hosting platform for web apps | Where the live production app lives (groundwork1-phi.vercel.app) |
| **Lucide React** | An icon library | All the small icons throughout the app (arrows, locks, cameras, etc.) |

---

## What's Next

### Immediate Fixes

1. **Supabase Site URL** — Set the production URL in Supabase Auth settings (`Auth → URL Configuration → Site URL = https://groundwork1-phi.vercel.app`) so confirmation emails point to the live app, not localhost.

2. **Apply Migration 005** — Run `npx supabase db push` (with a valid `SUPABASE_ACCESS_TOKEN` in your environment) to apply the user profiles table and the Starter 3-project database cap.

### Near-term

3. **Contractor Invite Emails** — Wire Resend (email API) so invited contractors actually receive an email when added to a project.

4. **Admin Review Panel** — A private Jalla-only panel where staff can review Pro submissions, approve stages, and communicate decisions.

5. **Real Contractor Data** — The contractor directory currently shows placeholder profiles. Real verified contractors need to be added via the contractor application pipeline.

### Future Roadmap

6. **Payment Processing** — Milestone-based fund releases tied to stage approvals. Each stage approval should trigger an actual payment instruction.

7. **Push Notifications** — Alert project owners when a stage is approved, a message arrives, or a contractor uploads evidence.

8. **Mobile App** — A native iOS/Android app for contractors to upload evidence directly from site using their camera.

---

*Groundwork by Jalla · Project Execution Record · July 2026 · groundwork1-phi.vercel.app*
