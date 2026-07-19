import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { buildInviteHtml } from "./src/lib/email/invite-html";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // no prefix — loads all vars incl. RESEND_API_KEY

  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      // ── Dev-only: serve /api/send-email (generic email) ─────────────────────
      {
        name: "send-email-dev",
        apply: "serve" as const,
        configureServer(server) {
          server.middlewares.use("/api/send-email", (req: any, res: any) => {
            if (req.method !== "POST") {
              res.writeHead(405, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }
            const chunks: Buffer[] = [];
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", async () => {
              try {
                const { to, subject, html } = JSON.parse(
                  Buffer.concat(chunks).toString("utf8")
                );
                const apiKey = env.RESEND_API_KEY;
                if (!apiKey) {
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ success: true, note: "no-api-key" }));
                  return;
                }
                const r = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    from: "Groundwork by Jalla <noreply@mail.tryjalla.com>",
                    to: [to],
                    subject,
                    html,
                  }),
                });
                const json = await r.json().catch(() => ({}));
                if (r.ok) {
                  console.log(`\x1b[32m[email] sent → ${to}: ${subject}\x1b[0m`);
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ success: true }));
                } else {
                  console.error("[email] Resend error:", json);
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Resend API error", details: json }));
                }
              } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          });
        },
      },
      // ── Dev-only: serve /api/send-invite so invite emails work in local dev ──
      {
        name: "send-invite-dev",
        apply: "serve" as const,
        configureServer(server) {
          server.middlewares.use("/api/send-invite", (req: any, res: any) => {
            if (req.method !== "POST") {
              res.writeHead(405, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const chunks: Buffer[] = [];
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", async () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                const { toEmail, projectName, inviterName, inviteToken } = body;

                if (!toEmail || !projectName || !inviterName) {
                  res.writeHead(400, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Missing required fields" }));
                  return;
                }

                const apiKey = env.RESEND_API_KEY;
                if (!apiKey) {
                  console.warn(
                    "\x1b[33m[invite] RESEND_API_KEY not set in .env — email skipped\x1b[0m"
                  );
                  // Return success so UI doesn't show an error — the invite record exists
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ success: true, note: "no-api-key" }));
                  return;
                }

                const r = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    from: "Groundwork by Jalla <noreply@mail.tryjalla.com>",
                    to: [toEmail],
                    subject: `${inviterName} invited you to a Groundwork project`,
                    html: buildInviteHtml(inviterName, projectName, inviteToken ?? ""),
                  }),
                });

                const json = await r.json().catch(() => ({}));

                if (r.ok) {
                  console.log(`\x1b[32m[invite] email sent → ${toEmail}\x1b[0m`);
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ success: true }));
                } else {
                  console.error("[invite] Resend error:", json);
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Resend API error", details: json }));
                }
              } catch (err) {
                console.error("[invite] handler error:", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          });
        },
      },
    ],
    server: {
      port: 5174,
    },
    resolve: {
      tsconfigPaths: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("@sentry")) return "vendor-sentry";
              if (id.includes("framer-motion")) return "vendor-motion";
              if (id.includes("@supabase")) return "vendor-supabase";
              if (
                id.includes("react-dom") ||
                id.includes("react-router") ||
                id.includes("/react/")
              ) return "vendor-react";
            }
          },
        },
      },
    },
  };
});
