import { readFileSync, readdirSync } from 'node:fs';
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
const sql108   = read('supabase/migrations/108_verifier_self_registration.sql');
const sql108Code = sql108.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON [\s\S]*?;\s*$/gm, '');
const sql086   = read('supabase/migrations/086_verifiers.sql');
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
  it('both doors open without an invitation, and say so in the config', () => {
    // 105 made the verifier door invitation-only, on the argument that a verifier's
    // signature releases a stage payment. That is true of an ASSIGNED verifier: holding
    // the bare role reaches no project, because project_verifiers has no write policy
    // and only assign_verifier (086, admin-only) ever writes one. So 108 opened it, the
    // same way 106 opened the contractor's.
    const contractor = form.slice(form.indexOf('contractor: {'), form.indexOf('verifier: {'));
    const verifier   = form.slice(form.indexOf('verifier: {'));
    expect(contractor).toMatch(/openWithoutInvite: true/);
    expect(verifier).toMatch(/openWithoutInvite: true/);
    // The branch still exists, so closing a door again is one word.
    expect(form).toMatch(/if \(!preview && !cfg\.openWithoutInvite\) \{/);
  });

  it('registers rather than claims when there is no invitation, per role', () => {
    // An invitation is claimed and links the applicant's own records; a bare signup
    // grants the role and nothing else. Each door carries its own registrar, so one
    // role can never be granted by the other's page.
    expect(form).toMatch(/if \(preview\) cfg\.remember\(token\);/);
    expect(form).toMatch(/else if \(cfg\.openWithoutInvite\) cfg\.rememberOpen\?\.\(\);/);
    const contractor = form.slice(form.indexOf('contractor: {'), form.indexOf('verifier: {'));
    const verifier   = form.slice(form.indexOf('verifier: {'));
    expect(contractor).toMatch(/rememberOpen: rememberContractorRegistration/);
    expect(verifier).toMatch(/rememberOpen: rememberVerifierRegistration/);
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


describe('108 — the verifier door is open, and the assignment is what still is not', () => {
  it('grants the verifier role and nothing else', () => {
    expect(sql108Code).toMatch(/INSERT INTO public\.user_roles \(user_id, role\) VALUES \(v_actor, 'verifier'\)/);
    expect(sql108Code).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
    // Signing up must not put anybody on a project, or near one.
    expect(sql108Code).not.toMatch(/INSERT INTO public\.project_verifiers/);
    expect(sql108Code).not.toMatch(/assign_verifier|verifier_profiles|stage_verifications/);
  });

  it('takes no role argument, so it can never be asked for admin', () => {
    expect(sql108Code).toMatch(/FUNCTION public\.register_verifier_account\(\)/);
    expect(sql108Code).not.toMatch(/register_verifier_account\(\s*p_/);
    expect(sql108Code).not.toMatch(/'admin'|'contractor'|'homeowner'/);
  });

  it('refuses an anonymous caller', () => {
    expect(sql108Code).toMatch(/not_signed_in/);
    expect(sql108Code).toMatch(/REVOKE ALL ON FUNCTION public\.register_verifier_account\(\) FROM PUBLIC, anon;/);
    expect(sql108Code).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_verifier_account\(\) TO authenticated;/);
  });

  it('writes one audit row per new role, not one per call', () => {
    expect(sql108Code).toMatch(/v_new := FOUND;/);
    expect(sql108Code).toMatch(/IF v_new THEN[\s\S]*?log_activity/);
  });

  /**
   * THE LOAD-BEARING ONE. Opening the signup is only safe because putting a named
   * verifier on a named project stays with staff. If either of these two facts changes,
   * a self-granted role becomes a way onto somebody's project.
   */
  it('assignment is still admin-only, which is what makes an open signup safe', () => {
    const fn = sql086.slice(sql086.indexOf('FUNCTION public.assign_verifier'));
    expect(fn.slice(0, fn.indexOf('$$;'))).toMatch(/NOT public\.is_admin\(\)[\s\S]*?RAISE EXCEPTION 'not_admin/);
  });

  it('project_verifiers still has no write policy for anybody', () => {
    // Every policy on that table must be SELECT. An INSERT or ALL policy would let a
    // self-registered verifier put themselves on a project without an admin.
    const policies = [...sql086.matchAll(/CREATE POLICY[\s\S]{0,200}?ON public\.project_verifiers FOR (\w+)/g)]
      .map(m => m[1]);
    expect(policies.length).toBeGreaterThan(0);
    expect([...new Set(policies)]).toEqual(['SELECT']);
  });

  it('records the rule that follows from being open', () => {
    expect(sql108).toMatch(/never gate a capability on the bare `verifier` role/i);
  });
});


describe('the role survives the email round trip', () => {
  /**
   * THE BUG THIS CLOSES. The role is granted by /auth/callback, from a marker parked in
   * localStorage by the signup page. /auth/callback runs in whatever browser opens the
   * confirmation mail — so on a laptop/phone split, a private window, or blocked storage,
   * the marker is simply absent. The code then fell through to postAuthPath with no role
   * and no finished onboarding, which routes to /onboarding: the CLIENT flow. The person
   * had a real account, was signed in, held nothing, and it looked like the product had
   * signed them up as the wrong thing. Philip hit exactly this.
   */

  it('records the door on the ACCOUNT, not only in browser storage', () => {
    expect(form).toMatch(/signupMetadata\(fullName\.trim\(\), canonicalPhone, role as SignupIntent\)/);
    const lib = read('src/lib/auth/signup-account.ts');
    expect(lib).toMatch(/signup_intent\?: SignupIntent/);
  });

  it('the callback grants on EITHER signal, so one being lost is survivable', () => {
    expect(callback).toMatch(/takeRememberedContractorRegistration\(\) \|\| intent === 'contractor'/);
    expect(callback).toMatch(/takeRememberedVerifierRegistration\(\) \|\| intent === 'verifier'/);
    // Read through the narrower, never straight off user_metadata.
    expect(callback).toMatch(/signupIntentOf\(session\.user\?\.user_metadata\?\.signup_intent\)/);
  });

  it('the intent is narrowed to the two doors whose RPC anyone may already call', () => {
    // It must never become a general role channel. These two are safe ONLY because 106
    // and 108 grant them to any signed-in user already, so the hint confers nothing new.
    const lib = read('src/lib/auth/signup-account.ts');
    expect(lib).toMatch(/SIGNUP_INTENTS: readonly SignupIntent\[\] = \['contractor', 'verifier'\]/);
    expect(lib).toMatch(/export type SignupIntent = 'contractor' \| 'verifier'/);
    // Scoped to the intent itself: `'homeowner'` is the account-type radio elsewhere in
    // this file, which is copy, not a grantable role.
    const intentDecl = lib.slice(lib.indexOf('export type SignupIntent'), lib.indexOf('signupIntentOf'));
    expect(intentDecl).not.toMatch(/'admin'|'homeowner'/);
  });

  it('nothing reads the intent as a role — it only selects an already-open RPC', () => {
    // The 100 rule still holds: no browser-set key may reach user_roles.
    expect(callback).not.toMatch(/user_roles/);
    expect(callback).toMatch(/registerContractorAccount\(\)/);
    expect(callback).toMatch(/registerVerifierAccount\(\)/);
  });

  it('no migration grants a role from signup metadata', () => {
    // An earlier draft of 100 did exactly this and had to be dropped. Nothing may
    // reintroduce a trigger that reads raw_user_meta_data and writes a role.
    const all = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter(f => f.endsWith('.sql'))
      .map(f => read(`supabase/migrations/${f}`)).join('\n')
      .replace(/^\s*--.*$/gm, '');
    expect(all).not.toMatch(/raw_user_meta_data[\s\S]{0,200}?INSERT INTO public\.user_roles/);
    expect(all).not.toMatch(/signup_intent/);
  });
});

describe('somebody who already has an account can be put right', () => {
  it('offers to add the role instead of making a second account', () => {
    expect(form).toMatch(/if \(!authLoading && session\)/);
    expect(form).toMatch(/addToThisAccount/);
    expect(form).toMatch(/cfg\.registerNow\(\)/);
  });

  it('says so plainly, and says nothing else changes', () => {
    const en = read('src/lib/i18n/en.ts');
    const start = en.indexOf('    roleSignup: {');
    const block = en.slice(start, en.indexOf('\n    },', start));
    expect(block).toMatch(/would make a second account/);
    expect(block).toMatch(/You keep the same email, password/);
  });

  it('tells someone who already holds the role rather than granting it twice', () => {
    expect(form).toMatch(/alreadyHas/);
    expect(form).toMatch(/auth\.roleSignup\.alreadyHave/);
  });

  it('reloads after granting, so the new role is actually read', () => {
    // A client-side navigate would keep the stale AuthContext and bounce them back.
    expect(form).toMatch(/window\.location\.href = cfg\.surface/);
  });
});


describe('a freshly granted role is visible to the surface it unlocks', () => {
  /**
   * THE BUG PHILIP HIT. AuthContext resolves `isContractor` / `isVerifier` ONCE, when
   * the session is established — which is before any role is granted in the callback.
   * The role surfaces guard on that value:
   *
   *     work/_layout.tsx:      if (resolved && !allowed) navigate('/dashboard')
   *     verifiers/_layout.tsx: if (resolved && !allowed) navigate('/dashboard')
   *
   * So a client-side `navigate("/work")` straight after granting arrives with the stale
   * answer and is bounced to the CLIENT dashboard. Signing up as a contractor landed on
   * the client dashboard, deterministically, with a brand-new account.
   *
   * A full page load makes the context re-read. One load, once, when somebody gains a
   * role — and the only alternative is teaching AuthContext to re-check on demand, which
   * is a bigger change with more ways to be subtly wrong.
   */

  const grants = [
    'claimContractorAccount(claim)',
    'registerContractorAccount()',
    'claimVerifierAccount(verifierClaim)',
    'registerVerifierAccount()',
    'acceptInvite(token)',
  ];

  it.each(grants)('%s hands off with a reload, never a client-side navigate', (call) => {
    const at = callback.indexOf(call);
    expect(at, `${call} is not in the callback`).toBeGreaterThan(-1);
    // The handoff is whatever comes next, before that branch returns.
    const after = callback.slice(at, callback.indexOf('return;', at));
    expect(after, `${call} must reload so the new standing is read`).toMatch(/leaveForRoleSurface\(/);
    expect(after, `${call} must not client-side navigate into a role surface`).not.toMatch(/navigate\(/);
  });

  it('the helper really does a full load', () => {
    const fn = callback.slice(callback.indexOf('function leaveForRoleSurface'));
    expect(fn.slice(0, fn.indexOf('\n  }'))).toMatch(/window\.location\.href = path/);
  });

  it('both shells still guard on the role — which is why the reload is needed', () => {
    // If these ever stop bouncing, the reload is belt and braces rather than load
    // bearing; while they do bounce, removing it reintroduces the bug.
    for (const shell of ['src/app/routes/work/_layout.tsx', 'src/app/routes/verifiers/_layout.tsx']) {
      const code = read(shell).replace(/^\s*\/\/.*$/gm, '');
      expect(code, shell).toMatch(/resolved && !allowed/);
      expect(code, shell).toMatch(/navigate\('\/dashboard', \{ replace: true \}\)/);
    }
  });
});


describe('both kinds of contractor reach the same place', () => {
  /**
   * There are two ways to be a contractor and they are the SAME role with the SAME
   * dashboard:
   *
   *   · a PARTNER signs up at /contractor-signup and holds `user_roles.contractor`;
   *   · an INVITED contractor is brought onto one project and may hold NO role row at
   *     all — only `contractor_invites.status = 'accepted'`.
   *
   * `holdsContractorAccess` is what reconciles them, and the danger is a second opinion:
   * if the shell asked `user_roles` directly while sign-in asked this, an invited
   * contractor would sign in to /work and be bounced straight back out.
   */

  it('standing is the role OR an accepted assignment, never only the role', () => {
    const roles = read('src/lib/auth/roles.ts');
    const fn = roles.slice(roles.indexOf('export async function holdsContractorAccess'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/eq\('role', 'contractor'\)/);
    expect(body).toMatch(/holdsContractorAssignment\(userId\)/);
    expect(body).toMatch(/\|\| assignment/);
  });

  it('every decider uses that one function — no second opinion anywhere', () => {
    for (const f of [
      'src/contexts/AuthContext.tsx',      // what the /work shell guards on
      'src/app/routes/auth/login.tsx',     // signing in
      'src/app/routes/auth/callback.tsx',  // confirming an email
      'src/app/routes/auth/new-password.tsx',
    ]) {
      const code = strip(read(f));
      expect(code, `${f} must ask holdsContractorAccess`).toMatch(/holdsContractorAccess\(/);
      // Asking user_roles for 'contractor' here would be the second opinion that leaves
      // an invited contractor locked out of their own dashboard.
      expect(code, `${f} must not decide contractor standing itself`)
        .not.toMatch(/eq\('role',\s*'contractor'\)/);
    }
  });

  it('both land on /work — one dashboard, not two', () => {
    const roles = read('src/lib/auth/post-auth-path.ts');
    expect(roles).toMatch(/if \(opts\.isContractor\) return '\/work';/);
    // And ahead of the client branches, so a contractor is never sent to onboarding or
    // the client dashboard just because they have not finished a client-only step.
    const onWork = roles.indexOf("return '/work'");
    expect(roles.indexOf("return '/onboarding'")).toBeGreaterThan(onWork);
    expect(roles.indexOf("return '/dashboard'")).toBeGreaterThan(onWork);
  });
});
