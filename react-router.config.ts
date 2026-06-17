import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src/app",
  // SPA mode: auth state is read client-side (supabase.auth.getSession()),
  // so there's no server-side session to render against.
  ssr: false,
  future: {
    v8_middleware: true,
    v8_passThroughRequests: true,
    v8_splitRouteModules: true,
    v8_trailingSlashAwareDataRequests: true,
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
