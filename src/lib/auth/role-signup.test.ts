import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two front doors (100's contractor claim, 105's verifier invitation).
 *
 * A contractor and a verifier each have exactly one place to sign up, and each page says
 * which one it is. What has to stay true is not the wording but the gate: neither page may
 * create an account that the role behind it has not been earned for.
 *
 * That is the defect 100 was written to fix — "the directory listing existed, the person
 * existed, and nothing joined them" — and the reason the old hand-off to /auth/signup was
 * wrong twice over: it greeted an approved contractor as a client, and it could produce an
 * account with no standing at all.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** The comments argue for these properties, so scanning them would prove nothing. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const form     = strip(read('src/components/auth/RoleSignup.tsx'));
const routes   = strip(read('src/app/routes.ts'));
const email    = strip(read('src/lib/email/application-decision-html.ts'));
const vEmail   = strip(read('src/lib/email/verifier-invite-html.ts'));
const callback = strip(read('src/app/routes/auth/callback.tsx'));
const handler  = strip(read('api/_handlers/invite-verifier.ts'));
const claimPg  = strip(read('src/app/routes/claim.tsx'));
const sql      = read('supabase/migrations/105_verifier_invites.sql');
const sql106   = read('supabase/migrations/106_contractor_self_registration.sql');
/** 106's prose argues about 'admin' on purpose, so the role scan reads statements only. */
const sql106Code = sql106.replace(/^\s*--.*$/gm, '');

describe('one door each, and it says which', () => {
  it('both routes exist', () => {
    expect(routes).toMatch(/route\("contractor-signup",\s*"routes\/contractor-signup\.tsx"\)/);
    expect(routes).toMatch(/route\("verifier-signup",\s*"routes\/verifier-signup\.tsx"\)/);
  });

  it('the heading and the button say the role, in both languages', () => {
    for (const dict of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const d = read(dict);
      for (const key of ['contractorHeading', 'contractorSubmit', 'verifierHeading', 'verifierSubmit']) {
        expect(d, `${dict} lacks roleSignup.${key}`).toContain(`${key}:`);
      }
    }
  });

  it('the submit button is the role-specific string, not a generic one', () => {
    // The tester's complaint was that an approved contractor could not tell the page was
    // for them. A shared "Create account" label would bring that straight back.
    expect(form).toMatch(/t\(cfg\.submit\)/);
    expect(form).not.toMatch(/t\('auth\.signup\.submit'\)/);
  });
});

describe('the gate', () => {
  it('shows no form to a VERIFIER without a readable invitation', () => {
    // `preview` is null for an absent, unknown, withdrawn or malformed token. A verifier
    // stops there; a contractor does not, because a partner has no invitation to read
    // (106). `openWithoutInvite` is the whole difference, so it is what this pins.
    expect(form).toMatch(/if \(!preview && !cfg\.openWithoutInvite\) \{/);
    const gate = form.indexOf('if (!preview && !cfg.openWithoutInvite) {');
    expect(gate).toBeGreaterThan(-1);
    expect(form.slice(gate).includes('return (')).toBe(true);
    // The verifier door must be the closed one, and the contractor door the open one.
    const verifier = form.slice(form.indexOf('verifier: {'));
    expect(verifier).toMatch(/openWithoutInvite: false/);
    const contractor = form.slice(form.indexOf('contractor: {'), form.indexOf('verifier: {'));
    expect(contractor).toMatch(/openWithoutInvite: true/);
  });

  it('registers a partner rather than claiming, and only for the open door', () => {
    // A partner has nothing to claim, so the role is granted in the callback instead.
    expect(form).toMatch(/if \(preview\) cfg\.remember\(token\);/);
    expect(form).toMatch(/else if \(cfg\.openWithoutInvite\) rememberContractorRegistration\(\);/);
  });

  it('treats absent, unknown and withdrawn tokens identically', () => {
    // Distinguishing them would make the page an oracle for whether a token is real.
    expect(form).not.toMatch(/invalid_token|revoked|not_found/);
  });

  it('offers a spent invitation sign-in instead of a second account', () => {
    expect(form).toMatch(/preview\?\.claimed/);
    expect(form).toMatch(/claimedTitle/);
  });

  it('parks the token before sign-up, because the session lands in another tab', () => {
    const park = form.indexOf('cfg.remember(token)');
    const signUp = form.indexOf('supabase.auth.signUp');
    expect(park).toBeGreaterThan(-1);
    expect(signUp).toBeGreaterThan(park);
  });

  it('sends nothing role-shaped through signUp metadata', () => {
    // options.data is browser-set. 100 dropped a trigger that read it, and nothing may
    // reintroduce a role-bearing key here.
    expect(form).toMatch(/data: signupMetadata\(/);
    expect(form).not.toMatch(/account_type|role:\s*'(contractor|verifier)'/);
  });
});

describe('the callback finishes both claims', () => {
  it('attempts the verifier claim as well as the contractor one', () => {
    expect(callback).toMatch(/takeRememberedClaim\(\)/);
    expect(callback).toMatch(/takeRememberedVerifierClaim\(\)/);
    expect(callback).toMatch(/claimVerifierAccount\(/);
  });

  it('uses separate parking keys, so one role does not overwrite the other', () => {
    const c = read('src/lib/supabase/contractor-claim.ts');
    const v = read('src/lib/supabase/verifier-claim.ts');
    const keyOf = (s: string) => /= '([a-zA-Z]+)';/.exec(s.slice(s.indexOf('_KEY')))?.[1];
    expect(keyOf(c)).toBeTruthy();
    expect(keyOf(v)).toBeTruthy();
    expect(keyOf(c)).not.toBe(keyOf(v));
  });

  it('falls through to normal routing when a claim fails, rather than stranding them', () => {
    expect(callback).toMatch(/claimVerifierAccount\([\s\S]{0,120}?\} catch/);
  });
});

describe('the emails are the only place a token appears', () => {
  it('the acceptance email carries the contractor token to the branded door', () => {
    expect(email).toContain('/contractor-signup?t=${encodeURIComponent(claimToken)}');
  });

  it('the verifier invitation carries its token the same way', () => {
    expect(vEmail).toContain('/verifier-signup?t=${encodeURIComponent(token)}');
  });

  it('the handler never returns the token to the browser', () => {
    // The token grants the verifier role. The only place it may ever be written is the
    // engineer's inbox.
    expect(handler).toMatch(/res\.status\(200\)\.json\(/);
    const ok = handler.slice(handler.indexOf('res.status(200).json('));
    expect(ok).not.toMatch(/\btoken\b/);
  });

  it('issues the invitation as the caller, not the service role', () => {
    // issue_verifier_invite reads auth.uid() for is_admin() and for invited_by; a
    // service-role client has neither.
    expect(handler).toMatch(/asCaller\s*\n?\s*\.rpc\('issue_verifier_invite'|asCaller\.rpc\('issue_verifier_invite'/);
    expect(handler).toMatch(/rpc\('is_admin'\)/);
  });

  it('sends nothing when no token could be issued', () => {
    // Unlike the contractor decision, there is no tokenless fallback: a verifier's
    // standing comes only from the token, so a mail without one cannot be honoured.
    const issue = handler.indexOf('issue_verifier_invite');
    const send  = handler.indexOf('api.resend.com');
    expect(issue).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(issue);
    // Ordering alone is weak — what matters is the refusal between them. A missing or
    // non-string token returns before anything is mailed.
    const between = handler.slice(issue, send);
    expect(between).toMatch(/if \(issueErr \|\| typeof token !== 'string'\)/);
    expect(between).toMatch(/return;/);
  });
});

describe('the old hand-off is gone', () => {
  it('/claim/:token points at the branded door and carries the token', () => {
    expect(claimPg).toContain('/contractor-signup?t=${encodeURIComponent(token ?? \'\')}');
    expect(claimPg).not.toMatch(/\/auth\/signup\?email=/);
  });
});

describe('105 grants the role only through the token', () => {
  it('claiming inserts the verifier role, and nothing else can', () => {
    expect(sql).toMatch(/INSERT INTO public\.user_roles \(user_id, role\) VALUES \(v_actor, 'verifier'\)/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
  });

  it('refuses a claim with no session, and a spent token from another account', () => {
    expect(sql).toMatch(/not_signed_in/);
    expect(sql).toMatch(/already_claimed/);
  });

  it('only an admin may invite or withdraw', () => {
    const invite = sql.slice(sql.indexOf('FUNCTION public.issue_verifier_invite'));
    const revoke = sql.slice(sql.indexOf('FUNCTION public.revoke_verifier_invite'));
    expect(invite.slice(0, invite.indexOf('$$;'))).toMatch(/NOT public\.is_admin\(\)/);
    expect(revoke.slice(0, revoke.indexOf('$$;'))).toMatch(/NOT public\.is_admin\(\)/);
  });

  it('the preview is readable by anon but the claim is not', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.verifier_invite_preview\(uuid\)\s+TO anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.claim_verifier_account\(uuid\)\s+FROM PUBLIC, anon;/);
  });

  it('a withdrawn invitation stops previewing', () => {
    // Otherwise a revoked link would still name the person it was for.
    const preview = sql.slice(sql.indexOf('FUNCTION public.verifier_invite_preview'));
    expect(preview.slice(0, preview.indexOf('$$;'))).toMatch(/revoked_at IS NULL/);
  });

  it('records who withdrew one, since log_activity cannot hold the act', () => {
    // An invitation has neither a project nor a person, and log_activity refuses that.
    expect(sql).toMatch(/revoked_by  uuid/);
    expect(sql).toMatch(/CHECK \(\(revoked_at IS NULL\) = \(revoked_by IS NULL\)\)/);
  });

  it('never calls log_activity with an entity type but no id', () => {
    // 089 raises `bad_entity` for that, which would make the call fail at runtime.
    for (const m of sql.matchAll(/log_activity\(([^;]*?)\);/g)) {
      const args = m[1];
      expect(args, `entity type without an id: ${args.trim()}`).not.toMatch(/'[a-z_]+',\s*NULL/);
    }
  });
});


describe('106 — the partner door is open, and only that far', () => {
  it('grants the contractor role and nothing else', () => {
    expect(sql106).toMatch(/INSERT INTO public\.user_roles \(user_id, role\) VALUES \(v_actor, 'contractor'\)/);
    expect(sql106).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
    // No listing, no application, no project: a self-registered partner is not a vetted
    // directory entry, and `public.contractors` is admin-write-only (033) regardless.
    expect(sql106).not.toMatch(/INSERT INTO public\.contractors/);
    expect(sql106).not.toMatch(/INSERT INTO public\.contractor_applications/);
    expect(sql106).not.toMatch(/INSERT INTO public\.projects/);
  });

  it('takes no role argument, so it can never be asked for admin', () => {
    // A `p_role text` parameter on a function every signed-in user may execute would be
    // a way to request 'admin'. The role is a literal and the signature is empty.
    expect(sql106).toMatch(/FUNCTION public\.register_contractor_account\(\)/);
    expect(sql106).not.toMatch(/register_contractor_account\(\s*p_/);
    // No other role is named by any statement in the file.
    expect(sql106Code).not.toMatch(/'admin'|'verifier'|'homeowner'/);
  });

  it('refuses an anonymous caller', () => {
    expect(sql106).toMatch(/not_signed_in/);
    expect(sql106).toMatch(/REVOKE ALL ON FUNCTION public\.register_contractor_account\(\) FROM PUBLIC, anon;/);
    expect(sql106).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_contractor_account\(\) TO authenticated;/);
  });

  it('writes one audit row per new role, not one per call', () => {
    // ON CONFLICT swallows a repeat insert, so FOUND is what distinguishes a first call
    // from a refresh. Without it, reloading the callback would log forever.
    expect(sql106).toMatch(/v_new := FOUND;/);
    expect(sql106).toMatch(/IF v_new THEN[\s\S]*?log_activity/);
  });

  it('calls log_activity with a person and no entity, which 089 requires', () => {
    // 089 raises `no_subject` with neither project nor person, and `bad_entity` for an
    // entity type without an id. A role grant has no row to point at.
    expect(sql106).toMatch(/log_activity\(NULL, 'contractor\.self_registered', NULL, NULL, v_actor,/);
  });

  it('records the rule that follows from being open', () => {
    // The one thing a future change could get wrong: gating a partner's ability to bring
    // their own clients on a role that is now self-granted.
    expect(sql106).toMatch(/must NOT be gated on the bare contractor role/);
  });
});
