# Account security — what is in the code, and what you must switch on

Four things shipped together: a password strength meter, one password policy enforced
everywhere, TOTP two-factor authentication, and fixes to a password reset flow that was
broken in two places.

**Three of them are only half-true until someone changes a setting in the Supabase
dashboard.** Those settings are the first three sections here. Nothing below needs a
deploy.

---

## 1. Server-side password minimum — 5 minutes

The policy in [`src/lib/auth/password-policy.ts`](../src/lib/auth/password-policy.ts) runs
in the browser. A browser policy is a usability feature, not a control: anyone can call
the Supabase Auth REST endpoint directly and set whatever password they like.

Supabase → **Authentication → Sign In / Providers** → scroll to **Auth Providers** →
expand the **Email** row. The settings are on that panel:

| Setting | Value |
|---|---|
| Minimum password length | **10** |
| Password Requirements | Lowercase, uppercase letters and digits |

> Not under the left nav's **Policies** item — that one carries an ↗ and jumps to
> *Database → Policies*, which is Row Level Security and has nothing to do with passwords.
> An earlier version of this doc sent people there.

That makes the floor real. The client policy stays, because it is the half that can
explain itself while someone is typing — the server can only refuse.

> The "must not contain your own name or email" rule stays client-only — Supabase has no
> hook for it, and it needs the profile to compare against. The common-password blocklist
> has a far better server-side counterpart: see §3.

## 2. Enable MFA — 2 minutes

Supabase → **Authentication → Multi-Factor** (its own item in the left nav, under
CONFIGURATION — *not* inside Sign In / Providers) → enable **TOTP / App Authenticator**.

Without this, `/profile` → Security shows an error where the 2FA panel should be, because
`listFactors()` is refused at the project level. That is deliberate — a silent empty
panel would read as a bug in the page.

**Check:** sign in, open `/profile` → Security, and *Set up two-factor authentication*
produces a QR code.

## 3. Leaked-password protection — 1 minute, and it closes a real gap

Supabase → **Authentication → Attack Protection** → enable **Prevent use of leaked
passwords**.

This checks every new password against Have I Been Pwned's breach corpus, k-anonymously,
server-side. It is the one thing the client policy explicitly cannot do: the blocklist in
`password-policy.ts` is the *head* of the distribution — around forty entries — because a
real corpus is hundreds of millions and has no business in a bundle every visitor
downloads. This is that check, free, and on the server where it also covers direct API
calls.

The two complement each other rather than overlap. The client list catches `Groundwork1`
while someone is still typing and explains why; this catches the password that is unique,
compliant, passes every rule, and is already in a dump.

While on that page, **Enable Captcha protection** is worth considering separately — it is
the control against someone grinding the login form, which none of the password work
above addresses.

## 4. Enforce MFA at the database — not done, and worth deciding on

This is the gap to be honest about.

The app refuses to *route* a session that has not cleared its second factor — `/auth/login`
and `/auth/callback` both stop at the code form. But that session still holds a valid JWT,
so **PostgREST will still answer it**. Someone who stole a password and could make requests
by hand would be stopped by the UI and not by the database.

Closing it means adding an AAL check to the policies that matter, for users who have a
factor enrolled:

```sql
-- Illustrative. Applying this to every table is a migration of its own, and it locks out
-- anyone mid-challenge, so it wants a deliberate rollout rather than a copy-paste.
CREATE POLICY "owner_select_projects_aal" ON public.projects FOR SELECT
  USING (
    auth.uid() = user_id
    AND (
      (SELECT auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors f
        WHERE f.user_id = auth.uid() AND f.status = 'verified'
      )
    )
  );
```

Until that lands, 2FA here is a strong control against a stolen password used through the
product, and not a control against a stolen password used against the API. Both are worth
having; only one of them is currently true.

---

## What changed in the code

### One password policy, shared

[`src/lib/auth/password-policy.ts`](../src/lib/auth/password-policy.ts) is the only
definition. Required: **10 characters, upper, lower, a digit**, not on the common-password
list, and not containing the user's own name or email. A symbol is not required — it moves
the strength meter but does not gate submission, because length plus a blocklist does more
work than symbol mandates, which mostly produce `Password1!`.

**The bar was 8 characters, and only on one of the two screens that set a password.**
`/auth/new-password` — the page you reach from a reset email — checked `length >= 8` and
nothing else. So the way to put a weak password on an account was to register with a
compliant one and then reset it. Both screens now import the same module.

### Strength meter

[`PasswordStrength`](../src/components/ui/PasswordStrength.tsx), on signup and
new-password. Four segments plus a word; colour reinforces the reading but never carries it
alone, per [SCREEN-DESIGNS.md](SCREEN-DESIGNS.md).

The meter and the checklist deliberately disagree: the checklist is what the form will
accept, the meter is how good the password actually is. `Abcdefghi1` is valid and reads
*Weak*, which is true and is the point — a bar that filled the moment the last box ticked
would tell people the minimum is the target.

### Two-factor authentication

TOTP only. SMS is weaker everywhere, and here it would mean international delivery to MTN
and Orange numbers, per-message cost, and a factor that breaks when somebody travels or
swaps a SIM — the normal state of this audience, not the edge case.

- Enrol and disable at `/profile` → Security.
- Challenged at `/auth/login` **and** `/auth/callback`. The callback matters: Google
  sign-in lands there, so leaving it out would have made the OAuth button a way past 2FA.
- The challenge runs **before** the recovery branch, so a password reset on a 2FA account
  asks for the code too. Otherwise "forgot password" would be the way around the second
  factor — take the mailbox, take the account.
- Cancelling the challenge signs out. Backing out silently would leave a real half-session
  in the browser.

**Locked-out users are recovered by hand.** There are no recovery codes. Supabase does not
issue them, and the alternatives were worse than a support conversation for the volume
here. Verify identity out of band, then:

```sql
DELETE FROM auth.mfa_factors WHERE user_id = '<uid>';
```

### Password reset — two broken links

Both sent a valid, single-use token somewhere that could not consume it:

| Where | Sent to | What happened |
|---|---|---|
| `/profile` → *Send reset link* | `/auth/reset-password` | The **request form**. The token was spent and you landed back on "enter your email", with no way to set a password. Changing your password from the profile was impossible. |
| `/auth/callback` → *Resend* | `/auth/callback` with no `flow=recovery` | The replacement link came back indistinguishable from a sign-in, leaving only the localStorage record — which that same page clears on success and which is absent on another device. |

Both now point at `/auth/callback?flow=recovery`. That marker exists because Supabase's
PKCE reply carries no `type`, so nothing else distinguishes a reset from a sign-in.

**The flow ends on a confirmation, not a redirect.** This is the half that was still
failing after the mechanism was fixed. Setting a password used to redirect silently onto
the dashboard — signed in, told nothing — which from the user's side is indistinguishable
from the "it just logs you in" bug it replaced. That perception is the reported reason
adoption stalled, so `/auth/new-password` now ends on an explicit "your password has been
changed", naming the other devices that were signed out, with a button rather than an
automatic jump. A trust product cannot perform its most security-sensitive action
invisibly.

**Other sessions are now revoked on reset.** Supabase leaves existing sessions signed in
when a password changes, so whoever was already in stayed in on the old refresh token.
Resetting the password looked like it locked them out and did not. `/auth/new-password`
now calls `signOut({ scope: 'others' })` — this browser survives, everything else does not.

### "Your password was changed" email

Sent automatically whenever `auth.users.encrypted_password` changes — migration
`070_password_changed_email.sql`. Bilingual, from the recipient's `preferred_lang`.

**It is a database trigger, not a `sendEmail()` call, and that is the whole design.** The
obvious implementation is a line in `/auth/new-password.tsx` after `updateUser()`, through
the `/api/send-email` endpoint that already exists. It would be worthless. The entire
value of this email is that it reaches the account owner when the person changing the
password is *not* the account owner — and in exactly that scenario, the browser running
the code belongs to the attacker, who simply does not send it. `/api/send-email` also
takes its recipient verbatim from the caller, so a modified client could redirect it.
A tripwire the intruder controls is not a tripwire.

Firing from Postgres removes the client from the decision. It fires for a reset link, a
change from the profile page, a change made in the Supabase dashboard, and one made by
calling the Auth API with curl. There is no path to `encrypted_password` that misses it.

It deliberately does **not** claim "we signed out your other devices" — that happens in
`new-password.tsx` and so only on the reset path. An email promising a security action
that did not occur is worse than one that stays quiet.

**Needs `resend_api_key` in `app_config`** — already set, if agent-request notifications
are arriving. Without it the trigger logs `skipped` and changes nothing else.

When someone reports a missing notification:

```sql
SELECT event, step, detail, created_at
  FROM public.security_notify_log ORDER BY created_at DESC LIMIT 10;
```

`sent` means Resend accepted it and the question is delivery. `skipped` names the missing
setting. `failed` carries the error. No rows at all means the trigger never fired — check
it exists:

```sql
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

---

## Testing it

| Suite | Covers |
|---|---|
| `src/lib/auth/password-policy.test.ts` | 25 tests over the shared policy. It exists because the two screens diverged once already and the weaker rule was the one on the reset page. |
| `src/lib/auth/mfa.test.ts` | 25 tests over the parts of the MFA wrapper that are **decisions**, not passthrough — see below. |
| `docs/recording/check_password_ui.py` | Drives the real signup form in headless Chrome. Needs a dev server; not part of `pnpm test`. |

**What `mfa.test.ts` does and does not claim.** Most of `mfa.ts` hands straight to
`supabase.auth.mfa`, and testing that would only assert the mocks. Four places are not
passthrough, and each fails silently in its own direction: `challengeRequired()` decides
whether anyone is asked for a code at all (and must fail *open*, or a bad AAL lookup locks
every user out of the product); `getMfaStatus()` must not count an abandoned, unverified
factor as "On", which would tell someone they are protected when they are not;
`clearUnverified()` is the only reason a second enrolment attempt is possible after
somebody closes the dialog; and `verifyCode()` normalises the `123 456` people paste off a
phone. Those are pinned. **The integration itself is not tested and cannot be from here.**

**`check_password_ui.py` is the one that proves the policy reaches the screen.** Unit tests
cannot: between the policy and the user sit a component, two dictionaries and a form, and a
missing i18n key or an unrendered component would pass every unit test while the meter
showed nothing. It walks the real DOM — meter appears on the first keystroke, climbs
Weak → Good → Strong, floors to 0 on a blocklisted or self-referencing password, and the
submit handler refuses. It is client-side only and never presses submit with an acceptable
password, so it is safe to run against a dev server pointed at production.

Run it with:

```bash
npx vite --port 5199 --strictPort &
.venv/bin/python docs/recording/check_password_ui.py
```

### Still only testable by hand

The 2FA flows have never been executed — TOTP is not yet enabled on the project, so
`enrollTotp`, `verifyCode` and `challengeRequired` have not once run against real Supabase.
Enable it (§2), then walk these:

1. Enrol at `/profile` → Security. Scan, enter a code, confirm the badge reads **On**.
2. Sign out, sign in with the password. The code form must appear before the dashboard.
3. Cancel it — you should land signed out, not signed in.
4. Sign in with Google. The code form must appear there too.
5. Request a password reset. The code form must appear before the new-password screen.
6. Set a new password. You must land on a confirmation screen — **not** the dashboard —
   that says the password changed and that other devices were signed out.
7. Confirm a session left open in another browser really has been signed out.
8. Check the inbox for "Your Groundwork password was changed".

Migration 070's trigger was exercised against a local Postgres 16 before shipping — that
it stays quiet on signup, on ordinary sign-ins, and on a no-op rewrite of the same hash;
that it fires on a real change and on an OAuth account gaining its first password; that a
name containing `<script>` is escaped; and that **a failed or unconfigured send never rolls
back the password change**. Those are the properties to re-check if the function is edited.
