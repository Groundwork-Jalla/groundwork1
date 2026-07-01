import { route, layout } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  // Public landing page
  route("/", "routes/landing.tsx"),
  route("contractor-apply", "routes/contractor-apply.tsx"),
  route("community", "routes/community.tsx"),

  // Auth routes (public)
  layout("routes/_auth-layout.tsx", [
    route("auth/login", "routes/auth/login.tsx"),
    route("auth/signup", "routes/auth/signup.tsx"),
    route("auth/reset-password", "routes/auth/reset-password.tsx"),
    route("auth/callback", "routes/auth/callback.tsx"),
  ]),

  // Protected app routes
  layout("routes/_layout.tsx", [
    route("dashboard",       "routes/dashboard.tsx"),
    route("projects/new",    "routes/projects/new.tsx"),
    route("projects/:id",    "routes/projects/detail.tsx"),
  ]),
] satisfies RouteConfig;
