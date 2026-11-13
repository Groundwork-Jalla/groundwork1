import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A contractor is never demoted by a failed read.
 *
 * Favour, 9 Nov 2026: "some contractors that signed up as contractors somehow,
 * somewhere, end up in client's dashboard... I don't know at what point or what they
 * click that does that."
 *
 * There was no click. The chain was:
 *
 *   roles.ts          `return !error && (data?.length ?? 0) > 0`  — error becomes false
 *   AuthContext       `setRolesChecked(true)`                     — either way
 *   work/_layout.tsx  `if (resolved && !allowed) navigate('/dashboard', {replace:true})`
 *
 * So one dropped request on any contractor page turned a contractor into a client, on
 * whatever screen they happened to be looking at, with history replaced so Back could
 * not undo it. Nothing about it was tied to an action, which is exactly how it was
 * described.
 *
 * Four separate instances of "a contractor ended up in the client view" were fixed as
 * individual routing bugs before this — the logo, Help, the project wizard, the sign-in
 * invite path. This is the generator behind that class.
 */

const roles  = readFileSync('src/lib/auth/roles.ts', 'utf8');
const auth   = readFileSync('src/contexts/AuthContext.tsx', 'utf8');
const access = readFileSync('src/hooks/useAccountAccess.ts', 'utf8');
const snapshot = readFileSync('src/lib/auth/account-access.ts', 'utf8');
const work   = readFileSync('src/app/routes/work/_layout.tsx', 'utf8');
const strip  = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a read says whether it got an answer', () => {
  it('RoleRead can admit it does not know', () => {
    expect(roles).toMatch(/export type RoleRead =\s*\n\s*\| \{ ok: true; held: boolean \}\s*\n\s*\| \{ ok: false; error: string \}/);
  });

  it.each(['readVerifierRole', 'readContractorAccess', 'readContractorAssignment'])(
    '%s reports an error instead of returning false', fn => {
      const body = roles.slice(roles.indexOf(`export async function ${fn}`));
      const end = body.indexOf('\n}\n');
      expect(body.slice(0, end)).toMatch(/return \{ ok: false, error:/);
    });

  it('and no reader still collapses an error into a boolean', () => {
    // The exact shape that caused this.
    expect(strip(roles)).not.toMatch(/return !error && \(data\?\.length \?\? 0\) > 0;/);
    expect(strip(roles)).not.toMatch(/!role\.error && \(role\.data\?\.length \?\? 0\) > 0/);
  });

  it('a throw is caught too, not just a returned error', () => {
    // Offline, DNS, an aborted fetch: supabase-js rejects rather than returning.
    expect((roles.match(/catch \(err\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('either yes settles it', () => {
  it('the role alone is enough, even if the assignment read failed', () => {
    /**
     * Holding the contractor role and having an accepted assignment are each
     * sufficient. Requiring both reads to succeed before believing a YES would
     * reintroduce the same fragility from the other side.
     */
    const fn = roles.slice(roles.indexOf('export async function readContractorAccess'));
    expect(fn).toMatch(/if \(role\.ok && role\.held\) return \{ ok: true, held: true \};/);
    expect(fn).toMatch(/if \(assignment\.ok && assignment\.held\) return \{ ok: true, held: true \};/);
  });

  it('but "no" needs both to have answered', () => {
    const fn = roles.slice(roles.indexOf('export async function readContractorAccess'));
    expect(fn).toMatch(/if \(!role\.ok\) return role;\s*\n\s*if \(!assignment\.ok\) return assignment;/);
  });
});

describe('rolesChecked means answered, not attempted', () => {
  it('all flags use one successful account snapshot', () => {
    expect(auth).toContain('useAccountAccess(session?.user?.id, loading, session?.access_token)');
    expect(auth).toContain('const rolesChecked = checked;');
    expect(snapshot).toContain("supabase.rpc('my_account_access')");
    expect(access).toContain('if (result.ok) {');
    expect(access).toContain('setState({ userId, access: result.access });');
  });

  it('a failed read retries rather than guessing', () => {
    expect(access).toContain('attempt < 4');
    expect(access).toContain('setTimeout(resolve, 400 * 2 ** attempt)');
  });

  it('and leaves the flag down when it runs out of tries', () => {
    expect(access).toContain('const checked = !loading && (!userId || access !== null);');
    expect(access).not.toMatch(/setState\([^\n]*role: 'client'/);
    expect(snapshot).toContain("return { ok: false, error:");
  });

  it('never combines role flags from different reads or sessions', () => {
    expect(snapshot).toContain('data.user_id !== userId');
    expect(access).toContain('current.current !== userId || request !== version.current');
    expect(auth).toContain('const isVerifier = access?.isVerifier ?? false;');
    expect(auth).toContain('const isContractor = access?.isContractor ?? false;');
  });
});

describe('the gate that did the damage still waits on a real answer', () => {
  it('work/_layout only redirects once roles are resolved', () => {
    expect(work).toMatch(/if \(resolved && !allowed\) navigate\('\/dashboard', \{ replace: true \}\)/);
    expect(work).toContain('const resolved = rolesChecked &&');
    expect(work).toContain('currentProjectAccess.allowed !== null');
  });
});
