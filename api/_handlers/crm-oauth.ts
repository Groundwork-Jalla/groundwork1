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
 * If Groundwork ever needs to serve locations it does not own, this is where a real
 * token exchange would go.
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

export default async function handler(req: any, res: any) {
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

  // Logged, never stored: it is single-use, short-lived, and nothing here redeems it.
  console.log('[ghl-oauth] install completed, authorisation code received (not exchanged)');

  res.status(200).send(page(
    'Groundwork is connected',
    'You can close this tab and return to GoHighLevel. Emails Groundwork sends will ' +
    'appear on each contact&rsquo;s Conversations thread.',
  ));
}
