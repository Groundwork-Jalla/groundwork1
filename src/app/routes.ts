import { route, layout } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  // Public pages — all share the site navbar and footer
  layout("routes/_public-layout.tsx", [
    route("/",                 "routes/landing.tsx"),
    route("contractor-apply",  "routes/contractor-apply.tsx"),
    route("pricing",           "routes/pricing.tsx"),
    // Jalla Management enquiry. Owns the call-then-form order so the
    // questionnaire is reachable regardless of Google Calendar settings.
    route("jalla-management",  "routes/jalla-management.tsx"),
    route("verify/:id",        "routes/verify.tsx"),
    // Required by Google OAuth verification and Stripe before going live.
    route("privacy",           "routes/privacy.tsx"),
    route("terms",             "routes/terms.tsx"),
  ]),

  // Auth routes (public) — shared architectural layout
  layout("routes/_auth-layout.tsx", [
    route("auth/login",          "routes/auth/login.tsx"),
    route("auth/signup",         "routes/auth/signup.tsx"),
    route("auth/reset-password", "routes/auth/reset-password.tsx"),
    route("auth/new-password",   "routes/auth/new-password.tsx"),
    route("auth/callback",       "routes/auth/callback.tsx"),
    route("onboarding",          "routes/onboarding.tsx"),
    route("invite/:token",       "routes/invite.tsx"),
  ]),

  // Project wizard — full-screen, no sidebar (WizardShell owns the viewport)
  route("projects/new",          "routes/projects/new.tsx"),

  // Protected app routes — all share the sidebar shell
  layout("routes/_layout.tsx", [
    route("dashboard",           "routes/dashboard.tsx"),
    route("documents",           "routes/documents.tsx"),
    route("projects",            "routes/projects/index.tsx"),
    route("projects/:id",        "routes/projects/detail.tsx"),
    // Contractor take-off. Its own routes rather than a tab on projects/detail — that
    // page is 7 tabs at max-w-5xl and a 30-row editable grid does not fit. Deep-linkable
    // because "here's my BQ" is a URL a contractor sends.
    route("projects/:id/takeoff",             "routes/projects/takeoff.tsx"),
    route("projects/:id/takeoff/:takeoffId",  "routes/projects/takeoff.detail.tsx"),
    route("resources",           "routes/resources.tsx"),
    route("resources/:slug",     "routes/resources.detail.tsx"),
    route("contractors",         "routes/contractors.tsx"),
    route("payments",            "routes/payments.tsx"),
    route("upgrade",             "routes/upgrade.tsx"),
    route("notifications",       "routes/notifications.tsx"),
    route("profile",             "routes/profile.tsx"),
    route("help",                "routes/help.tsx"),
  ]),

  // Free public planning tools — no auth, no sidebar
  layout("routes/tools/_tools-layout.tsx", [
    route("tools",              "routes/tools/index.tsx"),
    route("tools/budget",       "routes/tools/budget.tsx"),
    route("tools/stages",       "routes/tools/stages.tsx"),
    route("tools/milestones",   "routes/tools/milestones.tsx"),
    route("tools/tracker",      "routes/tools/tracker.tsx"),
  ]),

  // Staff sign-in. Outside the admin layout: that layout sends unauthenticated
  // visitors here, so nesting it inside would redirect to itself forever.
  route("admin/login",           "routes/admin/login.tsx"),

  // Admin panel (role-guarded inside its own layout)
  // ── /work — the contractor's execution surface ──
  //
  // NOT /contractors: that path is the client-facing directory of contractors to browse
  // and request quotes from, and renaming it would break the client nav and every link
  // already pointing at it. /work says what the surface is for — "what am I expected to
  // do now" — and deliberately avoids /jobs, since Jalla is not a job board.
  layout("routes/work/_layout.tsx", [
    route("work",                   "routes/work/index.tsx"),
    route("work/projects",          "routes/work/projects.tsx"),
    route("work/projects/:projectId","routes/work/projects.detail.tsx"),
  ]),

  // ── /verifiers — the independent verifier's surface (06 §22) ──
  // A separate product from /admin: the same core data, a different actor, a different
  // authority. The gate is the role; the isolation is RLS (086/087).
  layout("routes/verifiers/_layout.tsx", [
    route("verifiers",     "routes/verifiers/index.tsx"),
    route("verifiers/:id", "routes/verifiers/detail.tsx"),
  ]),

  layout("routes/admin/_admin-layout.tsx", [
    route("admin",               "routes/admin/index.tsx"),
    // Both are what the Overview's "See all" opens onto: the full Action Center queue and
    // the full activity log. They ship with the Overview because a five-row preview whose
    // See all lands on a placeholder is the dead end the Overview must not have.
    route("admin/action-center", "routes/admin/action-center.tsx"),
    route("admin/audit-log",     "routes/admin/audit-log.tsx"),
    route("admin/reviews",       "routes/admin/reviews.tsx"),
    route("admin/budgets",       "routes/admin/budgets.tsx"),
    route("admin/projects",      "routes/admin/projects.tsx"),
    route("admin/projects/new",  "routes/admin/projects.new.tsx"),
    // The Project Workspace (Phase 5). Declared after /new so the literal segment wins;
    // tab, stage and conversation are search params, never nested routes (05 §5).
    route("admin/projects/:id",   "routes/admin/projects.detail.tsx"),
    route("admin/users",         "routes/admin/users.tsx"),
    route("admin/users/new",     "routes/admin/users.new.tsx"),
    route("admin/contractors",   "routes/admin/contractors.tsx"),
    // Path is fixed: api/ghl/contractor.ts writes /admin/applications/:id into
    // every CRM record as `application_url`.
    route("admin/applications",     "routes/admin/applications.tsx"),
    route("admin/applications/:id", "routes/admin/applications.detail.tsx"),
    route("admin/crm",              "routes/admin/crm.tsx"),
    route("admin/waitlist",         "routes/admin/waitlist.tsx"),
    route("admin/drafts",           "routes/admin/drafts.tsx"),
    route("admin/requests",         "routes/admin/requests.tsx"),
    route("admin/inbox",            "routes/admin/inbox.tsx"),
    route("admin/support",          "routes/admin/support.tsx"),
    route("admin/inquiries",        "routes/admin/inquiries.tsx"),
    // TEMPORARY: sidebar items with no page yet (ADMIN_PLACEHOLDERS in nav-config.ts). A
    // static route above always wins over this dynamic one; anything not in the list 404s.
    route("admin/:section",         "routes/admin/placeholder.tsx"),
  ]),
] satisfies RouteConfig;
