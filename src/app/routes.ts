import { route, layout } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  // Public pages
  route("/",                   "routes/landing.tsx"),
  route("contractor-apply",    "routes/contractor-apply.tsx"),
  route("community",           "routes/community.tsx"),
  route("pricing",             "routes/pricing.tsx"),
  route("verify/:id",          "routes/verify.tsx"),

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
    route("resources",           "routes/resources.tsx"),
    route("contractors",         "routes/contractors.tsx"),
    route("payments",            "routes/payments.tsx"),
    route("notifications",       "routes/notifications.tsx"),
    route("profile",             "routes/profile.tsx"),
  ]),

  // Free public planning tools — no auth, no sidebar
  layout("routes/tools/_tools-layout.tsx", [
    route("tools",              "routes/tools/index.tsx"),
    route("tools/budget",       "routes/tools/budget.tsx"),
    route("tools/stages",       "routes/tools/stages.tsx"),
    route("tools/milestones",   "routes/tools/milestones.tsx"),
    route("tools/tracker",      "routes/tools/tracker.tsx"),
  ]),

  // Admin panel (role-guarded inside its own layout)
  layout("routes/admin/_admin-layout.tsx", [
    route("admin",               "routes/admin/index.tsx"),
    route("admin/reviews",       "routes/admin/reviews.tsx"),
    route("admin/projects",      "routes/admin/projects.tsx"),
    route("admin/users",         "routes/admin/users.tsx"),
    route("admin/contractors",   "routes/admin/contractors.tsx"),
  ]),
] satisfies RouteConfig;
