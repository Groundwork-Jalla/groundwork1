import { siteUrl } from '../../src/lib/site-url.js';
import { isValidEmail } from '../../src/lib/email/is-valid-email.js';
import { senderFor } from '../../src/lib/email/senders.js';
import { logEmailToCrm } from '../ghl/_email-log.js';

/**
 * Invite an interviewed engineer to become a Groundwork verifier (105).
 *
 * ── Why this is a server action and not a plain RPC call ─────────────────────────────
 * `issue_verifier_invite` is admin-gated in SQL, so the browser could call it directly.
 * What the browser must never do is hold the token: it is the capability that grants the
 * verifier role, and the only person who should ever see it is the engineer, in their
 * inbox. So the token is issued here, mailed here, and never put in a response.
 *
 * ── Issued as the CALLER, not the service role ──────────────────────────────────────
 * `issue_verifier_invite` reads `auth.uid()` for `invited_by` and for its own
 * `is_admin()` check. A service-role client has no `auth.uid()`, so the RPC would refuse
 * it. Same reasoning as send-application-decision.ts, which learned this first.
 *
 * ── No tokenless send ───────────────────────────────────────────────────────────────
 * If the token cannot be issued, nothing is emailed. The decision email can fall back to
 * a plain signup link because a contractor's standing comes from their application; a
 * verifier's comes only from this token, so a mail without one is a welcome that cannot
 * be honoured.
 */

const FROM = senderFor('verifier_invite');

function admin(): { url: string; key: string } | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cfg = admin();
  if (!cfg) {
    console.error('[verifier-invite] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!bearer) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const email    = str(req.body?.email, 254).toLowerCase();
  const fullName = str(req.body?.fullName, 120);
  const lang: 'en' | 'fr' = req.body?.lang === 'fr' ? 'fr' : 'en';

  if (!isValidEmail(email)) { res.status(400).json({ error: 'invalid_email' }); return; }
  if (fullName.length < 2)  { res.status(400).json({ error: 'name_required' }); return; }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? cfg.key;

  // Authorise as the caller: is_admin() reads auth.uid(), which a service-role client
  // does not have. This answers "is *this person* an admin".
  const asCaller = createClient(cfg.url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[verifier-invite] RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Email is not configured' });
    return;
  }

  // Idempotent for an open invitation: re-inviting returns the token already in their
  // inbox rather than minting a second live link.
  const { data: token, error: issueErr } = await asCaller
    .rpc('issue_verifier_invite', { p_email: email, p_full_name: fullName });

  if (issueErr || typeof token !== 'string') {
    const msg = issueErr?.message ?? 'no token returned';
    console.error('[verifier-invite] could not issue an invitation:', msg);
    // The RPC's own refusals are the useful ones — "already holds the verifier role" is
    // an answer, not a fault. Passed through by code so the admin UI can word it.
    const known = ['already_verifier', 'not_admin', 'invalid_email', 'name_required']
      .find(c => msg.includes(c));
    res.status(known === 'not_admin' ? 403 : known ? 409 : 500)
       .json({ error: known ?? 'invite_failed' });
    return;
  }

  try {
    const { buildVerifierInviteHtml, verifierInviteSubject } =
      await import('../../src/lib/email/verifier-invite-html.js');

    const subject = verifierInviteSubject(lang);
    const html = buildVerifierInviteHtml(lang, fullName, siteUrl(), token);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject, html }),
    });

    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      console.error('[verifier-invite] Resend rejected the message:', r.status, detail);
      // The invitation EXISTS at this point. Saying so matters: the admin can re-send it
      // from the directory, and a second attempt reuses the same token rather than
      // stranding the engineer with two live links.
      const stage = r.status === 401 || r.status === 403 ? 'credentials'
                  : r.status === 422                     ? 'address'
                  : 'send';
      res.status(r.status === 422 ? 422 : 502)
         .json({ error: 'Could not send the invitation', stage, invited: true });
      return;
    }

    // Every email to a person is noted in the CRM, so the whole conversation with an
    // engineer sits in one place — the invitation included. Best effort by design: the
    // invitation is sent and a missing note must not report that as a failure.
    const noted = await logEmailToCrm({ to: email, subject, html, kind: 'verifier_invite', name: fullName });

    // Deliberately no token in the response: see the note at the top of this file.
    res.status(200).json({ ok: true, email, notedInCrm: noted.ok, crmSurface: noted.surface });
    return;
  } catch (err) {
    console.error('[verifier-invite] Resend unreachable:', err);
    res.status(502).json({ error: 'Could not send the invitation', stage: 'send', invited: true });
  }
}
