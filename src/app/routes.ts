import { route, layout } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  // Public pages
  route("/",                   "routes/landing.tsx"),
  route("contractor-apply",    "routes/contractor-apply.tsx"),
  route("community",           "routes/community.tsx"),
  route("invite/:token",       "routes/invite.tsx"),
  route("pricing",             "routes/pricing.tsx"),

  // Auth routes (public)
  layout("routes/_auth-layout.tsx", [
    route("auth/login",          "routes/auth/login.tsx"),
    route("auth/signup",         "routes/auth/signup.tsx"),
    route("auth/reset-password", "routes/auth/reset-password.tsx"),
    route("auth/callback",       "routes/auth/callback.tsx"),
  ]),

  // Onboarding (post-signup, pre-dashboard)
  route("onboarding", "routes/onboarding.tsx"),

  // Protected app routes
  layout("routes/_layout.tsx", [
    route("dashboard",           "routes/dashboard.tsx"),
    route("profile",             "routes/profile.tsx"),
    route("projects/new",        "routes/projects/new.tsx"),
    route("projects/:id",        "routes/projects/detail.tsx"),
    route("contractors",         "routes/contractors.tsx"),
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
