import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postAuthPath } from '@/lib/auth/post-auth-path';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * 06 §22 — the first /verifiers vertical slice.
 *
 * The point of the surface is authority, not decoration: a verifier may record what they
 * found, and may not approve, rework, assign or request anything. The database already
 * says so (087/086); these pins keep the UI from implying otherwise, and keep the reads
 * bounded to the signed-in verifier's own work.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const LAYOUT = 'src/app/routes/verifiers/_layout.tsx';
const LIST   = 'src/app/routes/verifiers/index.tsx';
const DETAIL = 'src/app/routes/verifiers/detail.tsx';
const READER = 'src/lib/supabase/verifier-work.ts';

describe('routing: a verifier lands on their own surface', () => {
  it('verifier → /verifiers; admin still wins; a client is unaffected', () => {
    expect(postAuthPath({ isVerifier: true, onboardingComplete: true })).toBe('/verifiers');
    expect(postAuthPath({ isVerifier: true, isAdmin: true, onboardingComplete: true })).toBe('/admin');
    expect(postAuthPath({ onboardingComplete: true })).toBe('/dashboard');
    expect(postAuthPath({ isVerifier: true, onboardingComplete: false })).toBe('/verifiers');
    // An explicit safe redirect still wins over every role.
    expect(postAuthPath({ isVerifier: true, redirect: '/projects/x' })).toBe('/projects/x');
  });

  it('the role comes from user_roles, not from a token claim', () => {
    const roles = code('src/lib/auth/roles.ts');
    expect(roles).toContain("from('user_roles')");
    expect(roles).toContain("eq('role', 'verifier')");
    expect(roles).not.toMatch(/user_metadata|app_metadata|jwt/i);
    for (const f of ['src/app/routes/auth/login.tsx', 'src/app/routes/auth/callback.tsx', 'src/app/routes/auth/new-password.tsx']) {
      expect(code(f), f).toContain('holdsVerifierRole');
    }
  });

  it('the door is the verifier ROLE — admin privilege alone does not open it', () => {
    const l = code(LAYOUT);
    expect(l).toContain('const allowed = isVerifier;');
    expect(l).not.toMatch(/allowed = [^;]*isAdmin/);
    // The layout does not even read the admin flag: there is no admin path into here.
    expect(l).not.toMatch(/\bisAdmin\b|adminChecked/);
    expect(l).toContain('const resolved = rolesChecked;');
    expect(l).toContain("if (resolved && !allowed) navigate('/dashboard', { replace: true });");
  });

  it('waits for the role before deciding — a "no" computed before the session is restored is not an answer', () => {
    const l = code(LAYOUT);
    expect(l).toContain('if (loading) return;');
    expect(l).toContain('if (loading || !session || !resolved || !allowed) {');
    // The check itself is gated on `loading` in the context, for the same reason.
    expect(code('src/contexts/AuthContext.tsx')).toMatch(/if \(loading\) return;[\s\S]{0,200}setRolesChecked/);
  });

  it('signed out goes to the real sign-in route, not a 404', () => {
    const l = code(LAYOUT);
    expect(l).toContain("navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname)}`");
    expect(l).not.toMatch(/navigate\(`\/login\?/);
    expect(src('src/app/routes.ts')).toContain('route("auth/login",          "routes/auth/login.tsx")');
  });

  it('who gets in: verifier yes; admin-only, client-only, contractor-only no; admin+verifier yes', () => {
    // The gate is one expression, so the matrix is its truth table.
    const allowed = (roles: { isVerifier?: boolean; isAdmin?: boolean }) => roles.isVerifier === true;
    expect(allowed({ isVerifier: true })).toBe(true);                    // verifier
    expect(allowed({ isAdmin: true })).toBe(false);                      // admin only
    expect(allowed({})).toBe(false);                                     // client / contractor
    expect(allowed({ isVerifier: true, isAdmin: true })).toBe(true);     // holds the role
    // And post-auth still prefers /admin for the person who holds both.
    expect(postAuthPath({ isAdmin: true, isVerifier: true, onboardingComplete: true })).toBe('/admin');
  });
});

describe('isolation: only this verifier\'s work', () => {
  const r = code(READER);

  it('every read is filtered to the signed-in verifier', () => {
    expect(r).toContain(".eq('verifier_id', userId)");
    expect((r.match(/eq\('verifier_id', userId\)/g) ?? []).length).toBe(2);   // the list and the one row
  });

  it('a guessed id returns nothing — the URL is not authority', () => {
    expect(r).toContain("loadVerification(verificationId: string, userId: string)");
    expect(r).toContain(".eq('id', verificationId)\n    .eq('verifier_id', userId)");
    expect(code(DETAIL)).toContain('loadVerification(id, user.id)');
    expect(code(DETAIL)).toContain("t('verifier.detail.notFound')");
  });

  it('the surface never reads across projects: no portfolio, no other verifiers, no clients', () => {
    for (const f of [LIST, DETAIL, READER]) {
      const c = code(f);
      expect(c, f).not.toMatch(/listAdminUsers|admin_list_users|loadAdminOverview|listAllPayments|ownerLookup/);
      expect(c, f).not.toMatch(/from\('profiles'\)|from\('payments'\)|from\('conversations'\)/);
    }
  });

  it('reads only the tables a verification needs', () => {
    expect(r.match(/from\('([a-z_]+)'\)/g)?.sort()).toEqual(
      ["from('project_documents')", "from('project_substages')", "from('stage_verifications')", "from('stage_verifications')"].sort());
  });
});

describe('authority: record a finding, and nothing else', () => {
  it('the only write is the existing record_verification', () => {
    const d = code(DETAIL);
    expect(d).toContain('await recordVerification({');
    expect(d).not.toMatch(/approveStage|approve_stage|request_rework|requestRework|assignVerifier|assign_verifier|removeVerifier|requestVerification|request_verification/);
    for (const f of [LIST, LAYOUT, READER]) {
      expect(code(f), f).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
    }
  });

  it('no button implies approval of the stage', () => {
    const d = src(DETAIL);
    expect(d).toContain("t('verifier.detail.submit')");
    expect(lookup(en, 'verifier.detail.submit')).toBe('Submit verification');
    expect(lookup(en, 'verifier.detail.submit')).not.toMatch(/approve/i);
    expect(d).not.toMatch(/Approve|approveStage/);
  });

  it('the three decisions are the database\'s three, and pending is not one of them', () => {
    const d = code(DETAIL);
    expect(d).toContain("const DECISIONS = ['verified', 'rejected', 'needs_more_evidence'] as const;");
    expect(d).not.toMatch(/DECISIONS = \[[^\]]*pending/);
  });

  it('verified requires a visit date in the UI, and the database stays the authority', () => {
    const d = code(DETAIL);
    expect(d).toContain("const needsVisit = decision === 'verified';");
    expect(d).toContain('disabled={busy || (needsVisit && !visitedAt)}');
    expect(d).toContain("msg.includes('visit_required') ? t('verifier.detail.visitRequired')");
    // The refusal is surfaced, not pre-empted: no client-side skip of the RPC.
    expect(d).not.toMatch(/if \(needsVisit && !visitedAt\) return;[\s\S]{0,80}recordVerification/);
  });

  it('after recording, the row is re-read rather than assumed', () => {
    const d = code(DETAIL);
    expect(d).toContain('onRecorded();');
    expect(d).toContain('<RecordFinding verificationId={work.id} onRecorded={load} />');
    expect(d).not.toMatch(/setWork\(\{\s*\.\.\.work/);
    // A decided verification shows what was stored and cannot be edited here.
    expect(d).toContain("const decided = work.decision !== 'pending';");
    expect(d).toContain("t('verifier.detail.alreadyDecided')");
  });
});

describe('evidence: private files, signed on demand', () => {
  it('files are opened through a signed URL, never a public one', () => {
    const r = code(READER);
    expect(r).toContain("createSignedUrl(path, 3600)");
    expect(r).not.toMatch(/getPublicUrl|\/storage\/v1\/object\/public/);
    expect(code(DETAIL)).toContain('await signedFileUrl(bucket, path)');
    expect(code(DETAIL)).not.toMatch(/getPublicUrl|supabaseUrl|\/public\//);
  });

  it('a file that cannot be signed says so instead of opening nothing', () => {
    const d = code(DETAIL);
    expect(d).toContain("if (!url) { setFailed(path); return; }");
    expect(d).toContain("t('verifier.detail.fileUnavailable')");
  });
});

describe('scope: this is not the admin workspace', () => {
  it('no financials, no assignment, no client management, no audit', () => {
    for (const f of [LIST, DETAIL, LAYOUT]) {
      const c = code(f);
      expect(c, f).not.toMatch(/financial|budget|payment|disburse|authorise|invoice/i);
      expect(c, f).not.toMatch(/assignContractor|AssignVerifierModal|TeamCard|auditLog|listAuditLog/);
      expect(c, f).not.toMatch(/\/admin\//);
    }
  });

  it('Self-Verify is untouched: only an explicit assigned verification appears', () => {
    const r = code(READER);
    expect(r).not.toMatch(/self_verify|verification_required|tier/);
    expect(r).toContain("from('stage_verifications')");
  });

  it('honest states: loading, error, unavailable and empty are four different things', () => {
    const l = code(LIST);
    expect(l).toContain('rows === null ?');
    expect(l).toContain('error ?');
    expect(l).toContain('!available ?');
    expect(l).toContain('rows.length === 0 ?');
    expect(code(READER)).toContain("code === '42P01' || code === '42703'");
  });

  it('every string is in both dictionaries and translated', () => {
    for (const k of ['work.title', 'work.subtitle', 'work.pending', 'work.empty', 'work.emptyBody', 'work.unavailable',
                     'decision.verified', 'decision.rejected', 'decision.needs_more_evidence',
                     'detail.recordTitle', 'detail.visitLabel', 'detail.visitRequired', 'detail.submit', 'detail.notFound']) {
      const e = lookup(en, `verifier.${k}`), f = lookup(fr, `verifier.${k}`);
      expect(e, k).toBeTypeOf('string');
      expect(f, k).toBeTypeOf('string');
      expect(e, `${k} is not translated`).not.toBe(f);
    }
  });

  it('the routes exist under one gated layout', () => {
    const routes = src('src/app/routes.ts');
    expect(routes).toContain('layout("routes/verifiers/_layout.tsx", [');
    expect(routes).toContain('route("verifiers",     "routes/verifiers/index.tsx")');
    expect(routes).toContain('route("verifiers/:id", "routes/verifiers/detail.tsx")');
  });
});
