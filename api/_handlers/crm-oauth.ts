/**
 * Where GoHighLevel sends the browser after somebody installs our Marketplace app.
 *
 * ── Why this exists, and why it does almost nothing ──────────────────────────────────
 * The app exists for one reason: GHL will not let you define a **conversation provider**
 * without one, and a provider id is what lets an email we sent appear on a contact's
 * Conversations thread instead of as a read-only note.
 *
 * Creating the app forces OAuth details — a redirect URL and a scope list — because the
 * marketplace assumes every app wants to act on a customer's behalf with an OAuth token.
 * Ours does not. Every API call Groundwork makes authenticates with a Private
 * Integration Token issued directly to the Jalla sub-account (see `_client.ts`), which
 * needs no refresh machinery and no install flow.
 *
 * ── So the `code` is deliberately not exchanged ──────────────────────────────────────
 * We could swap it for an access token. We would then be storing and refreshing a
 * credential that nothing reads, on top of the PIT we already have — two ways in where
 * one is enough, and the extra one silently expiring at 3am. The install completes on
 * GoHighLevel's side regardless; this page exists so the browser lands somewhere honest
 * rather than on an error.
 *
 * ── Why it lives in `_handlers/` behind a rewrite ────────────────────────────────────
 * Vercel's Hobby plan allows twelve serverless functions and every file directly under
 * `api/` is one. A standalone `api/crm-oauth.ts` took us to exactly twelve, and over the
 * limit every deployment fails while the previous build keeps serving — the site looks
 * fine and nothing ships. So this is a handler behind `api/events.ts`, and `vercel.json`
 * rewrites `/api/crm-oauth` onto it so the redirect URL registered with GoHighLevel
 * keeps working. See src/lib/email/api-function-count.test.ts.
 *
 * ── The path deliberately avoids "ghl" ───────────────────────────────────────────────
 * This file lived at `api/ghl/oauth.ts` for about ten minutes. A white-label Marketplace
 * app refuses any redirect URL containing a HighLevel reference, and `/api/ghl/oauth`
 * counts as one — the URL is shown to the people installing the app, so their validator
 * enforces the white-labelling. Hence `/api/crm-oauth`, away from the rest of the GHL
 * code, which is why this file sits apart from `api/ghl/`.
 */

const page = (title: string, body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;
       font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#0a0a0a}
  .card{max-width:30rem;background:#fff;border:1px solid #e5e5e5;border-radius:12px;
        padding:32px;text-align:center}
  h1{margin:0 0 8px;font-size:18px}
  p{margin:0;font-size:14px;line-height:1.6;color:#5a5a57}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;

export async function handler(req: any, res: any) {
  const code = typeof req.query?.code === 'string' ? req.query.code : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!code) {
    // Someone opened the URL directly, or the install was cancelled.
    res.status(400).send(page(
      'Nothing to install',
      'This page is the redirect target for the Groundwork app in GoHighLevel. ' +
      'Open it from the install link rather than directly.',
    ));
    return;
  }

  // ── Exchange it ─────────────────────────────────────────────────────────────────
  // This used to log the code and discard it, on the reasoning that the Private
  // Integration Token did all the work and a second credential was needless machinery.
  // That was wrong in exactly one place: `/conversations/messages/inbound` posts as a
  // conversation provider, a provider belongs to this app, and GHL wants the caller to
  // be the app. The PIT is not the app, so it is refused however it is scoped.
  const { exchangeCode } = await import('../ghl/_oauth.js');
  const locationId = await exchangeCode(code);

  if (!locationId) {
    // The install itself still succeeded on GoHighLevel's side — only our token store
    // is empty, so email records fall back to notes. Say so rather than claiming success.
    res.status(200).send(page(
      'Installed, with one thing left',
      'Groundwork is connected, but the token exchange did not complete, so emails will ' +
      'be recorded as notes rather than conversation threads. Check that the client id ' +
      'and secret are set in app_config, then reinstall from the app&rsquo;s install link.',
    ));
    return;
  }

  console.log(`[ghl-oauth] install complete for location ${locationId}, token stored`);

  res.status(200).send(page(
    'Groundwork is connected',
    'You can close this tab and return to GoHighLevel. Emails Groundwork sends will ' +
    'appear on each contact&rsquo;s Conversations thread.',
  ));
}
