import { route, layout } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  // Public pages — all share the site navbar and footer
  layout("routes/_public-layout.tsx", [
    route("/",                 "routes/landing.tsx"),
    route("contractor-apply",  "routes/contractor-apply.tsx"),
    route("community",         "routes/community.tsx"),
    route("pricing",           "routes/pricing.tsx"),
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
  layout("routes/admin/_admin-layout.tsx", [
    route("admin",               "routes/admin/index.tsx"),
    route("admin/reviews",       "routes/admin/reviews.tsx"),
    route("admin/budgets",       "routes/admin/budgets.tsx"),
    route("admin/projects",      "routes/admin/projects.tsx"),
    route("admin/users",         "routes/admin/users.tsx"),
    route("admin/contractors",   "routes/admin/contractors.tsx"),
    // Path is fixed: api/ghl/contractor.ts writes /admin/applications/:id into
    // every CRM record as `application_url`.
    route("admin/applications",     "routes/admin/applications.tsx"),
    route("admin/applications/:id", "routes/admin/applications.detail.tsx"),
    route("admin/waitlist",         "routes/admin/waitlist.tsx"),
    route("admin/drafts",           "routes/admin/drafts.tsx"),
  ]),
] satisfies RouteConfig;
