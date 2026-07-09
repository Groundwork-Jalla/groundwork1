# Groundwork — Tester's Guide

**Base URLs**
- Local: `http://localhost:5173`
- Production: `https://groundwork1-phi.vercel.app`

---

## Public Pages (no login required)

### `/` — Landing Page
**What it is:** Marketing homepage for Groundwork by Jalla.

**What to check:**
- Navbar is sticky (stays at top when you scroll)
- Logo shows "Groundwork" with "by Jalla" directly below the G
- Hero section loads with animated illustration
- Stats bar animates numbers on scroll
- "What Jalla Does" section visible
- "With vs. Without" comparison section visible
- Social proof toast (e.g. "Emmanuel from Douala joined") appears bottom-left
- Footer at bottom: logo bottom-left, social icons right
- Back-to-top arrow appears after scrolling down
- "Join for Free" button links to `/community`
- "For Contractors" button links to `/contractor-apply`

**Working:** Layout, sticky nav, all sections, footer, back-to-top button, animations.

---

### `/community` — Waitlist / Community Signup
**What it is:** Split-screen page. Left side: dark blueprint panel with Groundwork logo. Right side: join form.

**What to check:**
- Page is NOT scrollable (fixed height, no page scroll)
- Left panel shows Groundwork logo centered
- Blueprint grid pattern visible in background
- Form has: Full name, Email, Where are you building? (optional)
- Countdown clock is visible and ticking
- Submitting the form saves to Supabase and shows a success state
- Success state shows "You're in." with a link to the Skool community
- Mobile view shows a black top bar with logo + "← Home" link

**Working:** Form submission, Supabase insert, success state, layout, non-scrollable.

---

### `/contractor-apply` — Contractor Application
**What it is:** Multi-step form for contractors to apply to join the Groundwork network.

**What to check:**
- Page loads with a form
- "For Contractors" label in nav area
- Back-to-top button appears on scroll
- Form steps progress correctly
- Submission saves to Supabase

**Working:** Layout, navigation, back-to-top. *(Email notification on apply: pending Resend setup)*

---

## Auth Pages (split-screen layout)

All auth pages share a layout: dark left panel (Groundwork logo + tagline) and white right panel (form). Uses `h-dvh` so it fits the screen without scrolling.

### `/auth/signup` — Sign Up
**What it is:** Create a new Groundwork account.

**What to check:**
- Form has: Full name, Email, Password, Confirm password
- Password strength checklist appears as you type (8+ chars, uppercase, number)
- Mismatched passwords shows inline error
- On submit: Supabase sends a confirmation email
- "Check your email" state appears after submit
- Confirmation email arrives from `noreply@mail.tryjalla.com` *(pending Resend DNS verification)*
- Clicking confirmation link goes to `/auth/callback` → then `/onboarding`
- "Already have an account? Log in" link works

**Working:** Form validation, Supabase signUp call, email sent, redirect to callback. Email branding: pending Resend setup.

**Known issue (fixed in code, not yet deployed):** Before the fix, the confirmation link went to the landing page root instead of `/auth/callback`. Fix is in `src/app/routes/auth/signup.tsx` — deploy to Vercel to activate.

---

### `/auth/login` — Log In
**What it is:** Sign in to an existing account.

**What to check:**
- Form has: Email, Password
- "Forgot password?" link goes to `/auth/reset-password`
- Wrong credentials shows Supabase error message inline
- Correct credentials redirect to `/dashboard`
- "Continue with Google" button is visible but disabled (coming soon tooltip)
- "Don't have an account? Sign up" link works

**Working:** Email/password login, error handling, redirect to dashboard.

---

### `/auth/reset-password` — Forgot Password
**What it is:** Request a password reset link by email.

**What to check:**
- Enter email and submit
- "Check your email" state appears
- Reset link email arrives
- Clicking the reset link goes to `/auth/callback` → dashboard

**Working:** Form, Supabase reset email call, success state.

---

### `/auth/callback` — Auth Callback *(internal, not user-facing)*
**What it is:** Handles the `?code=` token from Supabase confirmation and OAuth emails.

**What it does:**
- Exchanges the code for a session
- New users (no `onboarding_complete` flag) → `/onboarding`
- Returning users → `/dashboard`

**Working:** Code exchange, routing logic.

---

## Onboarding (authenticated, new users only)

### `/onboarding` — Account Setup
**What it is:** Two-step onboarding flow shown to new users after confirming their email.

**Step 1 — Welcome:**
- Dark full-screen page
- Shows "Welcome, [First Name]"
- "Get started" button advances to Step 2

**Step 2 — Choose a plan:**
- White page with 3 tier cards: Starter (Free), Pro ($19/mo), Enterprise (Custom)
- Selecting a tier saves `tier` and `onboarding_complete: true` to user metadata
- Redirects to `/dashboard`
- Enterprise option opens `mailto:hello@jalla.build` and still completes onboarding

**What to check:**
- First name is pulled from signup form (full_name metadata)
- Slide animation between steps works
- All 3 plan cards render correctly
- Selecting any plan saves and redirects

**Working:** Welcome step, plan selection, metadata save, redirect. Already-onboarded users skip this and go straight to dashboard.

---

## Authenticated App (login required)

### `/dashboard` — Your Projects
**What it is:** Main app view. Lists all of the user's projects.

**What to check:**
- Shows user's name and initials in top-right
- "Log out" button works and redirects to `/`
- "New Project" button links to `/projects/new`
- Empty state: dashed card "No projects yet — Create your first project"
- After projects exist: grid of project cards (name, status, tier, progress bar, budget)
- Starter plan shows a usage banner (e.g. "1 / 3 Starter projects used")
- At 3 Starter projects: "New Project" button is disabled with a tooltip
- Clicking a project card goes to `/projects/:id`

**Working:** Project list, empty state, Starter limit enforcement, logout.

---

### `/projects/new` — Create a Project (9-step wizard)
**What it is:** Step-by-step form to define a new construction project.

**Steps in order:**
1. Country (where you're building)
2. Project type (Residential / Commercial / Industrial / Mixed Use)
3. Building type (Single Family, Multi-Family, Office, etc.)
4. Number of floors
5. Rooms (bedrooms, bathrooms)
6. Boys' quarters (yes/no, and how many rooms)
7. Roof type (Long Span Aluminum, Clay Tiles, Concrete/Flat, Shingle)
8. Project details (name, city, target start date, finish level, sqm)
9. Summary + confirm

**What to check:**
- Each step advances on Next
- Back navigation works
- Step 9 shows a summary of all selections
- Submitting creates a project in Supabase and redirects to `/dashboard`
- The new project appears on the dashboard

**Working:** Full wizard flow, Supabase project creation.

---

### `/projects/:id` — Project Detail
**What it is:** Detailed view of a single project with 4 tabs.

**Project header shows:**
- Project name, city, country
- Tier badge (Starter / Pro / Enterprise)
- Overall % complete
- Spec card: type, scale, roof, finish level, target start date
- Budget estimate headline

**Tab: Stages**
- Lists all 10 construction stages (Foundation → Finishing, etc.)
- Each stage has sub-stages
- Starter tier: user can self-approve sub-stages
- Pro/Enterprise tier: sub-stages go to "Pending Review" state
- Evidence upload button per sub-stage (uploads photo/PDF to Supabase Storage)
- "Invite Contractor" panel at the bottom

**Tab: Budget**
- Breakdown of estimated costs by category
- Calculated from project specs (country, sqm, building type, finish level, etc.)

**Tab: Documents**
- Upload and view project documents (contracts, permits, invoices)
- Files stored in Supabase Storage

**Tab: Messages**
- Real-time project chat
- Messages stored in Supabase

**What to check:**
- All 4 tabs load without errors
- Stage tracker shows correct stages
- Sub-stage completion works (Starter: instant; Pro: pending)
- Evidence upload works
- Budget numbers are reasonable for the project specs
- Documents tab: upload and view a file
- Messages tab: send a message and see it appear

**Working:** All tabs load. Stage tracking, budget calculation, evidence upload. Real-time messages (requires Supabase Realtime enabled).

---

### `/profile` — Profile Settings
**What it is:** User account settings page.

**What to check:**
- Profile completion meter (0–100%, tracks 4 items)
- Editable fields: Display name, Phone number, Country
- "Save changes" button updates Supabase user metadata
- Button turns green briefly to confirm save
- Identity Verification section: upload a government ID (passport, national ID, driver's licence, max 5MB)
- Upload shows a progress bar
- After upload: "ID uploaded" confirmation with re-upload option
- Verification status badge: Not submitted / Pending Review / Identity Verified
- "Sign out" button at the bottom works

**Working:** Form save, ID upload to Supabase Storage, completion meter, sign out.

---

### `/contractors` — Contractor Directory
**What it is:** Browse verified contractors available on the platform.

**What to check:**
- List of contractor profiles (name, trade, location, rating, verified badge)
- Filter by trade / location (if available)
- Clicking a contractor shows their profile detail
- Contact options (phone, email, message) — gated by plan

**Working:** Contractor listing renders. *(Data is currently mock/static — real contractor profiles not yet populated)*

---

## Known Issues & Pending Items

| Item | Status |
|---|---|
| Confirmation email branding (sender name, template) | Pending — Resend DNS verification for `mail.tryjalla.com` |
| Email sent from `noreply@mail.tryjalla.com` | Pending — Resend SMTP not yet wired to Supabase |
| Confirmation link → `/auth/callback` (not root) | Code fixed, needs Vercel redeploy |
| Contractor invite email from project detail | Pending — Resend integration |
| Google OAuth ("Continue with Google") | Coming soon — disabled |
| Real contractor profiles | Pending — currently mock data |
| Social media links in footer | Pending — placeholder hrefs |
| "Powered by Supabase" in confirmation email | Cannot remove on free Supabase plan |

---

## Test User Flow (recommended order)

1. Go to `/auth/signup` → create account
2. Check email → click confirmation link → lands on `/onboarding`
3. Complete onboarding → select Starter plan → lands on `/dashboard`
4. Click "New Project" → complete all 9 wizard steps → lands on dashboard with new project
5. Click the project → explore all 4 tabs
6. On Stages tab: mark a sub-stage complete, upload evidence
7. Go to `/profile` → add phone number, country, upload an ID
8. Log out → log back in at `/auth/login`
9. Test `/auth/reset-password` with your email
