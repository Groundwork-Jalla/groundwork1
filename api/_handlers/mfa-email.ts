import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { senderFor } from '../../src/lib/email/senders.js';

/**
 * Email as a second factor — send a code, then check it.
 *
 * ── Why this is not Supabase MFA ─────────────────────────────────────────────────────
 * Supabase supports `totp`, `phone` and `webauthn`. There is no email factor, so this is
 * ours to build and ours to get right. A code verified here does NOT raise the session to
 * `aal2`; see migration 080 for what that does and does not mean.
 *
 * ── The rules this enforces, all server-side ─────────────────────────────────────────
 * Every one of these is here rather than in the browser, because a second factor checked
 * by the client is not a second factor:
 *
 *   · the code is never stored — only sha256(code || challenge id)
 *   · six digits from a CSPRNG, not Math.random
 *   · ten minutes, single use
 *   · five attempts per challenge, counted in the database
 *   · five sends per hour per account
 *   · the comparison is constant-time
 *   · a wrong code and an unknown challenge return the same thing
 */

const CODE_TTL_MINUTES  = 10;
const MAX_ATTEMPTS      = 5;
const MAX_SENDS_PER_HOUR = 5;

/** sha256(code || challengeId). The id is per-row, so one rainbow table cannot serve two. */
const hashCode = (code: string, challengeId: string): string =>
  createHash('sha256').update(`${code}${challengeId}`).digest('hex');

/** Constant-time. A comparison that returns early leaks the code one digit at a time. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function codeEmail(code: string): string {
  return '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;'
    + 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;margin:0 auto;'
    + 'background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
    + '<tr><td style="padding:26px 28px;">'
    + '<p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0a0a0a;">Your sign-in code</p>'
    + '<p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#4a4a48;">'
    + `Enter this to finish signing in. It expires in ${CODE_TTL_MINUTES} minutes.</p>`
    + '<p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
    + 'font-size:32px;font-weight:700;letter-spacing:0.18em;color:#0a0a0a;">'
    + code + '</p>'
    + '<p style="margin:22px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">'
    + 'If you did not try to sign in, someone has your password. Change it now — this code '
    + 'alone will not let them in.</p>'
    + '</td></tr></table></body></html>';
}

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const action = req.body?.op === 'verify' ? 'verify' : 'send';

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[mfa-email] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  // ── Send ───────────────────────────────────────────────
  if (action === 'send') {
    const { data: profile } = await admin
      .from('profiles')
      .select('email, email_mfa_enabled, preferred_lang')
      .eq('id', user.id)
      .maybeSingle();

    const address = profile?.email ?? user.email;
    if (!address) {
      res.status(400).json({ error: 'No email address on this account' });
      return;
    }

    // Rate limit on the ACCOUNT, not the browser. A client-side limit is a suggestion.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('email_otp_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
      // 429 rather than a lie: the user needs to know why nothing arrived.
      res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });
      return;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    // Insert first to get the id, then store the hash bound to it — the salt IS the id,
    // so it cannot be computed before the row exists.
    const { data: row, error: insertError } = await admin
      .from('email_otp_challenges')
      .insert({
        user_id:    user.id,
        code_hash:  'pending',
        expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !row) {
      console.error('[mfa-email] could not create challenge:', insertError?.message);
      res.status(500).json({ error: 'Could not send a code' });
      return;
    }

    await admin
      .from('email_otp_challenges')
      .update({ code_hash: hashCode(code, row.id) })
      .eq('id', row.id);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('[mfa-email] RESEND_API_KEY is not set');
      res.status(500).json({ error: 'Email is not configured' });
      return;
    }

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: senderFor('other'),
        to: [address],
        subject: 'Your Groundwork sign-in code',
        html: codeEmail(code),
      }),
    });

    if (!sent.ok) {
      console.error('[mfa-email] Resend rejected the code:', sent.status);
      res.status(502).json({ error: 'Could not send a code' });
      return;
    }

    // The id goes back so the client can name the challenge it is answering. It is not a
    // secret and it is useless without the code.
    res.status(200).json({ ok: true, challengeId: row.id, expiresInMinutes: CODE_TTL_MINUTES });
    return;
  }

  // ── Verify ─────────────────────────────────────────────
  const submitted = String(req.body?.code ?? '').trim();
  const challengeId = String(req.body?.challengeId ?? '').trim();

  if (!/^\d{6}$/.test(submitted) || !challengeId) {
    res.status(400).json({ error: 'Enter the six-digit code' });
    return;
  }

  const { data: challenge } = await admin
    .from('email_otp_challenges')
    .select('id, user_id, code_hash, expires_at, consumed_at, attempts')
    .eq('id', challengeId)
    // Scoped to the caller: a challenge id is not a secret, and without this anyone could
    // burn down someone else's attempt counter.
    .eq('user_id', user.id)
    .maybeSingle();

  // One answer for every failure. "No such challenge", "already used", "expired" and
  // "wrong code" are indistinguishable from outside, so none of them is a probe.
  const refuse = () => res.status(401).json({ error: 'That code is not valid.' });

  if (!challenge) { refuse(); return; }
  if (challenge.consumed_at) { refuse(); return; }
  if (new Date(challenge.expires_at).getTime() < Date.now()) { refuse(); return; }
  if (challenge.attempts >= MAX_ATTEMPTS) { refuse(); return; }

  // Counted BEFORE the comparison. Incrementing afterwards means a client that hangs up
  // mid-request gets a free guess.
  await admin
    .from('email_otp_challenges')
    .update({ attempts: challenge.attempts + 1 })
    .eq('id', challenge.id);

  if (!sameHash(challenge.code_hash, hashCode(submitted, challenge.id))) {
    refuse();
    return;
  }

  // Single use, and marked before the response so a replay in flight loses the race.
  await admin
    .from('email_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challenge.id);

  res.status(200).json({ ok: true });
}
