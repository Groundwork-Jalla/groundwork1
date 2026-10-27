# Supabase authentication emails

These files are Supabase Dashboard templates. An application deployment does not apply
them automatically.

In **Authentication → Email Templates**, paste each HTML file into its matching Body
field using Source view:

| Template | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your email address |
| Invite user | `invite-user.html` | Set up your Groundwork account |
| Reset password | `reset-password.html` | Reset your password |

## Site URL is not cosmetic

**Authentication → URL Configuration → Site URL must be `https://www.tryjalla.com`.**

Email buttons use the production origin directly and do not render `{{ .SiteURL }}`.
Keep the Supabase Site URL set to production as well, so other Auth redirects do not
send users to a preview deployment.

If it points at a preview deployment, other Supabase Auth flows may still send users to
`*.vercel.app`. The email templates avoid that by linking directly to the production
callback URL.

The footers are written out rather than templated so that at least the signature is
always the real domain; `src/lib/site-url.test.ts` fails the build if a template names a
deployment host or drops the canonical footer. Neither guard can see the dashboard, so
check the setting after any Supabase project change.

Keep `token_hash` and `type` in the links. They let the recipient open the email on their
own device and send invitations to password setup rather than the dashboard. Configure
the Supabase Site URL to the application origin, and include
`/auth/callback?flow=client-invite` under that origin in **Authentication → URL
Configuration → Redirect URLs**. Set `PUBLIC_SITE_URL` to the same origin on the server.
Supabase's SMTP sender must be configured for invitation delivery.

For contractor onboarding, the server reserves a new unconfirmed account without
choosing or exposing a password, records its required password setup and contractor
link, then calls `inviteUserByEmail`. The contractor receives only the account id and
email. They can build the client's project immediately on Self Verify, with no plan
selection step. The client must follow the invitation and save their own password before
entering the app. Existing accounts are refused and retain the flow where the owner
invites a contractor from their project.

Contractors returning to client onboarding can resume an account they already created
without sending another invitation. Project answers, the current step and edited budget
are saved for that contractor and client in the same browser tab until creation succeeds.
Quote files must be selected again after returning. Completed projects are excluded from
the unfinished-client list.

After deploying, check with a fresh client email address:

1. Create the account as a contractor. Confirm the screen shows that an invitation was
   sent, then create a project and verify it belongs to the client.
   Before finishing, leave and return after account creation and again midway through
   the wizard. Confirm the Next screen or last project step returns without a new invite.
2. Open the invitation on another device. Confirm the email is filled in and read-only,
   and a password and confirmation are required.
3. Before saving a password, try opening `/dashboard` and `/projects/new` directly. Both
   must return to setup without displaying the dashboard or project wizard.
4. Save a valid password, continue into the account, and check that the project appears.
5. Sign out and sign back in with the chosen password. The invitation is single-use;
   an expired or used link should offer the password-reset path.
