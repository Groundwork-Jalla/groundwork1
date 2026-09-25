import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postAuthPath } from '@/lib/auth/post-auth-path';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * /work — the contractor's execution surface.
 *
 * These pin the boundary, not the markup. The surface reads live project, stage, evidence
 * and payment rows, so what matters is WHO gets in, WHAT they can reach, and what the UI
 * must never offer. Each check is a source scan because none of it is visible to tsc.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/**
 * Comments discuss these rules at length; scanning raw text reads the warning as the
 * breach. Block comments are stripped too — a JSX `{/* … *\/}` explaining that there is no
 * reconcile control here is not a reconcile control.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');

/**
 * Just the quoted text. The custody rule is about words a person READS, so it is checked
 * against string literals — not identifiers. `import { Wallet } from 'lucide-react'` is an
 * icon, and failing the build over it would teach us to weaken the rule.
 */
const strings = (p: string) =>
  (code(p).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [])
    .filter(lit => !/^['"](?:@\/|\.\/|\.\.\/|lucide-react|react|node:)/.test(lit))
    .join('\n');

const LAYOUT = 'src/app/routes/work/_layout.tsx';
const DATA   = 'src/lib/supabase/contractor-work.ts';
const DASH   = 'src/app/routes/work/index.tsx';
const DETAIL = 'src/app/routes/work/projects.detail.tsx';
const SURFACES = [LAYOUT, DASH, DETAIL, 'src/app/routes/work/projects.tsx', 'src/components/shell/WorkShell.tsx', 'src/components/contractor/WorkOverview.tsx', DATA];

describe('the door', () => {
  it('gates on contractor standing, never on admin privilege', () => {
    const l = code(LAYOUT);
    expect(l).toMatch(/const allowed = isContractor;/);
    // An admin is not admitted for being an admin. If this ever reads `|| isAdmin`, an
    // operator with no site work walks into the contractor's execution surface.
    expect(l).not.toMatch(/allowed =[^;]*isAdmin/);
    expect(l).not.toMatch(/\bisAdmin\b/);
  });

  it('waits for the role answer before deciding — a "no" computed too early is not a no', () => {
    const l = code(LAYOUT);
    expect(l).toMatch(/const resolved = rolesChecked;/);
    expect(l).toMatch(/if \(loading\) return;/);
    expect(l).toMatch(/resolved && !allowed/);
  });

  it('sends the signed-out to /auth/login, which is the route that exists', () => {
    const l = code(LAYOUT);
    expect(l).toMatch(/\/auth\/login\?redirect=/);
    expect(l).not.toMatch(/navigate\('\/login'/);
  });

  it('asks the same question the database asks', () => {
    // is_contractor_on() checks accepted contractor_invites; the gate must agree, or the
    // door opens onto reads that then refuse.
    const roles = code('src/lib/auth/roles.ts');
    expect(roles).toMatch(/holdsContractorAssignment/);
    expect(roles).toMatch(/from\('contractor_invites'\)/);
    expect(roles).toMatch(/\.eq\('status', 'accepted'\)/);
    // NOT user_metadata, which the client can write.
    expect(roles).not.toMatch(/user_metadata/);
  });
});

describe('what the surface may reach', () => {
  it('never calls an admin or verifier RPC', () => {
    const FORBIDDEN = [
      'is_admin', 'admin_', 'record_verification', 'request_verification',
      'assign_verifier', 'admin_assign_contractor', 'approve_stage',
      'authorise_release', 'confirm_funding', 'admin_start_project_tracking',
    ];
    for (const file of SURFACES) {
      const src = code(file);
      for (const rpc of FORBIDDEN) {
        expect(src, `${file} references ${rpc}`).not.toContain(rpc);
      }
    }
  });

  it('lets RLS bound the reads instead of filtering in the browser', () => {
    const d = code(DATA);
    // No `.eq('contractor_user_id', …)` narrowing of projects here: membership is decided
    // by policy (086), and a browser-side filter would make the client the access control.
    expect(d).toMatch(/from\('projects'\)/);
    expect(d).not.toMatch(/from\('projects'\)[\s\S]{0,200}contractor_user_id/);
  });

  it('treats an unreadable source as unavailable, not as zero', () => {
    const d = code(DATA);
    expect(d).toMatch(/available: false/);
    const dash = code(DASH);
    // The KPI renders a dash when the answer is unknown. A 0 there would read as
    // "nothing owed", which is a different and untrue statement.
    expect(dash).toMatch(/unavailable/);
    expect(dash).toMatch(/'—'/);
  });

  it('signs private storage rather than building public URLs', () => {
    const d = code(DATA);
    expect(d).toMatch(/createSignedUrl/);
    expect(d).not.toMatch(/getPublicUrl/);
    expect(d).toMatch(/from\('evidence'\)/);
  });
});

describe('authority the contractor must not be offered', () => {
  it('offers no approval, assignment or money control anywhere on the surface', () => {
    const BANNED = [
      'Approve stage', 'Assign verifier', 'Assign contractor', 'Record verification',
      'Authorise release', 'Confirm funding', 'Reconcile',
    ];
    for (const file of SURFACES) {
      const src = strings(file).toLowerCase();
      for (const label of BANNED) {
        expect(src, `${file} offers "${label}"`).not.toContain(label.toLowerCase());
      }
    }
  });

  it('writes work only through submit_site_update, which re-checks who may report', () => {
    const d = code(DATA);
    expect(d).toMatch(/rpc\('submit_site_update'/);
    // The contractor cannot update substages directly — only owner_update_substages
    // exists — so any direct write here would simply fail.
    expect(d).not.toMatch(/from\('project_substages'\)[\s\S]{0,120}\.update\(/);
    expect(d).not.toMatch(/from\('project_stages'\)[\s\S]{0,120}\.update\(/);
    expect(d).not.toMatch(/from\('stage_verifications'\)[\s\S]{0,160}\.(update|insert)\(/);
  });

  it('makes a retry idempotent, because site connections drop mid-upload', () => {
    expect(code(DATA)).toMatch(/p_client_ref/);
    expect(code(DETAIL)).toMatch(/clientRef: crypto\.randomUUID\(\)/);
  });
});

describe('custody language stays out of the contractor surface', () => {
  it('never claims Groundwork holds the money', () => {
    const BANNED = /escrow|wallet|held securely|we hold|in trust|custody/i;
    for (const file of SURFACES) {
      expect(strings(file), file).not.toMatch(BANNED);
    }
    const copy = JSON.stringify([
      (en as Record<string, unknown>).contractor,
      (en as Record<string, unknown>).contractorPayments,
      (fr as Record<string, unknown>).contractor,
      (fr as Record<string, unknown>).contractorPayments,
    ]);
    expect(copy).not.toMatch(BANNED);
    expect(copy).not.toMatch(/séquestre|portefeuille/i);
  });

  it('names no payment provider in contractor-facing copy', () => {
    const copy = JSON.stringify([
      (en as Record<string, unknown>).contractorPayments,
      (fr as Record<string, unknown>).contractorPayments,
    ]);
    expect(copy).not.toMatch(/swychr|switchr|stripe|momo|gohighlevel|ghl/i);
  });
});

describe('i18n', () => {
  const keys = (o: unknown, prefix = ''): string[] =>
    typeof o === 'object' && o !== null
      ? Object.entries(o).flatMap(([k, v]) =>
          typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
      : [];

  it.each(['contractor', 'contractorDashboard', 'contractorProject', 'contractorStageStatus', 'contractorPayments', 'contractorSubmit'])(
    '%s has full EN/FR parity', ns => {
      const enKeys = keys((en as Record<string, unknown>)[ns]);
      const frKeys = keys((fr as Record<string, unknown>)[ns]);
      expect(enKeys.length).toBeGreaterThan(0);
      expect(frKeys.sort()).toEqual(enKeys.sort());
    });

  it('covers every real stage status, so none renders as a raw key', () => {
    const statuses = keys((en as Record<string, unknown>).contractorStageStatus).sort();
    expect(statuses).toEqual(['active', 'complete', 'locked', 'pending_review']);
  });
});

describe('routing', () => {
  it('does not collide with the client-facing /contractors directory', () => {
    const routes = code('src/app/routes.ts');
    expect(routes).toMatch(/route\("work",\s+"routes\/work\/index\.tsx"\)/);
    // The existing directory keeps its path; this surface is not it.
    expect(routes).toMatch(/route\("contractors",\s+"routes\/contractors\.tsx"\)/);
    expect(routes).not.toMatch(/layout\("routes\/work\/_layout\.tsx"[\s\S]{0,200}route\("contractors"/);
  });
});

describe('post-auth routing', () => {
  const done = { onboardingComplete: true };

  it('sends a contractor to their own surface, not the client dashboard', () => {
    expect(postAuthPath({ isContractor: true, ...done })).toBe('/work');
  });

  it('keeps the precedence deliberate: admin → verifier → contractor → client', () => {
    expect(postAuthPath({ isAdmin: true, isVerifier: true, isContractor: true, ...done })).toBe('/admin');
    expect(postAuthPath({ isVerifier: true, isContractor: true, ...done })).toBe('/verifiers');
    expect(postAuthPath({ isContractor: true, ...done })).toBe('/work');
    expect(postAuthPath({ ...done })).toBe('/dashboard');
  });

  it('does not divert a contractor into client onboarding', () => {
    // Onboarding sets up a build of your own. Someone invited onto somebody else's
    // project has none, and would be stuck on a step that does not apply to them.
    expect(postAuthPath({ isContractor: true, onboardingComplete: false })).toBe('/work');
  });

  it('still honours a safe deep link, and still refuses an unsafe one', () => {
    expect(postAuthPath({ isContractor: true, redirect: '/work/projects/abc', ...done }))
      .toBe('/work/projects/abc');
    expect(postAuthPath({ isContractor: true, redirect: '//evil.example', ...done })).toBe('/work');
  });

  it('every caller passes contractor standing, or the routing silently never fires', () => {
    for (const f of ['src/app/routes/auth/login.tsx',
                     'src/app/routes/auth/callback.tsx',
                     'src/app/routes/auth/new-password.tsx']) {
      expect(code(f), f).toMatch(/isContractor/);
    }
  });

  it('resolves contractor standing from the database, never from a login hint', () => {
    // A `?as=contractor` intent may say which surface someone WANTS; it must never be
    // what decides where they land.
    for (const f of ['src/app/routes/auth/login.tsx', 'src/app/routes/auth/callback.tsx']) {
      expect(code(f), f).toMatch(/holdsContractorAssignment/);
    }
  });
});
