import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sharing a build with family (112).
 *
 * One fact carries this whole feature: every policy behind `project_member()` is FOR
 * SELECT. That is what makes a fourth member kind safe — a viewer can read the build and
 * nothing more. These tests pin that fact, because the day somebody writes a WRITE policy
 * using `project_member()` is the day a family member can approve a stage.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON [\s\S]*?;\s*$/gm, '');
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sql    = read('supabase/migrations/112_project_viewers.sql');
const code   = strip(sql);
const panel  = stripTs(read('src/components/project/ShareProject.tsx'));
const detail = stripTs(read('src/app/routes/projects/detail.tsx'));
const page   = stripTs(read('src/app/routes/share.tsx'));

describe('a viewer can read the build and do nothing to it', () => {
  it('EVERY policy behind project_member() is a SELECT — the load-bearing fact', () => {
    // Checked across the whole migration set, not just 112: this is what bounds what a
    // viewer gains, and it bounds contractors and verifiers too.
    const dir = join(ROOT, 'supabase/migrations');
    const files = readFileSync(join(dir, '..', '..', 'package.json'), 'utf8') && null;
    void files;
    const all = require('node:fs').readdirSync(dir)
      .filter((f: string) => f.endsWith('.sql'))
      .map((f: string) => read(`supabase/migrations/${f}`))
      .join('\n')
      .replace(/^\s*--.*$/gm, '');

    // Every CREATE POLICY whose body mentions project_member(...) must be FOR SELECT.
    const offenders: string[] = [];
    for (const m of all.matchAll(/CREATE POLICY\s+"([^"]+)"[\s\S]{0,400}?(?=CREATE |ALTER |DROP |$)/g)) {
      const block = m[0];
      if (!/project_member\s*\(/.test(block)) continue;
      if (!/FOR SELECT/.test(block)) offenders.push(m[1]);
    }
    expect(offenders, `these gate a WRITE on project_member(): ${offenders.join(', ')}`).toEqual([]);
  });

  it('112 adds a viewer arm and keeps the other three', () => {
    const at = code.indexOf('FUNCTION public.project_member');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/p\.user_id = auth\.uid\(\)/);                 // owner
    expect(body).toMatch(/ci\.status = 'accepted'/);                     // contractor
    expect(body).toMatch(/pv\.status = 'active'/);                       // verifier
    expect(body).toMatch(/v\.accepted_at IS NOT NULL[\s\S]*?v\.revoked_at IS NULL/); // viewer
  });

  it('an unaccepted or withdrawn invitation grants nothing', () => {
    const at = code.indexOf('FUNCTION public.project_member');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/accepted_at IS NOT NULL/);
    expect(body).toMatch(/revoked_at IS NULL/);
  });
});

describe('only the owner shares their own project', () => {
  it('the invite refuses anybody who is not the owner — including an admin', () => {
    const at = code.indexOf('FUNCTION public.invite_project_viewer');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/v_owner <> v_actor/);
    expect(body).toMatch(/not_owner/);
    // Deliberately no is_admin() escape: whose finances a person shares is their call.
    expect(body).not.toMatch(/is_admin\(\)/);
  });

  it('the panel is shown on real ownership, not on browser metadata', () => {
    // `user_metadata.role` is browser-set, and since 112 "not a contractor" no longer
    // means "the owner" — a viewer is neither.
    expect(detail).toMatch(/const isOwner = !!user\?\.id && user\.id === project\?\.user_id;/);
    expect(detail).toMatch(/activeTab === 'overview' && isOwner &&/);
  });

  it('a viewer, or the owner, may end the access', () => {
    const at = code.indexOf('FUNCTION public.revoke_project_viewer');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/v_actor <> v_owner AND v_actor IS DISTINCT FROM v\.user_id/);
  });

  it('the table has no write policy — the RPCs are the only writers', () => {
    const onTable = [...code.matchAll(/ON public\.project_viewers FOR (\w+)/g)].map(m => m[1]);
    expect(onTable.length).toBeGreaterThan(0);
    expect([...new Set(onTable)]).toEqual(['SELECT']);
  });
});

describe('the invitation reaches somebody with no account', () => {
  it('the preview is readable before sign-in, and says nothing about money', () => {
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.project_viewer_preview\(uuid\)\s+TO anon, authenticated;/);
    const at = code.indexOf('FUNCTION public.project_viewer_preview');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/RETURNS TABLE \(project_name text, invited_by_name text, accepted boolean\)/);
    expect(body).not.toMatch(/budget|amount|payment|final_budget/i);
  });

  it('the page treats unknown, withdrawn and spent links identically', () => {
    // Otherwise it becomes a way to test whether a token is real.
    expect(page).toMatch(/if \(!preview\)/);
    expect(page).not.toMatch(/revoked|already_accepted|invalid_token/);
  });

  it('the token is parked, so signing up finishes the job', () => {
    expect(page).toMatch(/rememberShare\(token\)/);
    const cb = stripTs(read('src/app/routes/auth/callback.tsx'));
    expect(cb).toMatch(/takeRememberedShare\(\)/);
    expect(cb).toMatch(/acceptProjectViewer\(share\)/);
    // Ahead of the role doors: a family member is not signing up to work.
    expect(cb.indexOf('takeRememberedShare()')).toBeLessThan(cb.indexOf('registerContractorAccount()'));
  });

  it('re-inviting the same address reuses the link already in their inbox', () => {
    const at = code.indexOf('FUNCTION public.invite_project_viewer');
    const body = code.slice(at, code.indexOf('$$;', at));
    expect(body).toMatch(/SELECT token INTO v_token[\s\S]*?revoked_at IS NULL/);
    expect(body).toMatch(/IF v_token IS NOT NULL THEN RETURN v_token/);
  });
});

describe('what the people involved are told', () => {
  it('the invitee is told plainly that they cannot act', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  share: {'), en.indexOf('\n  },', en.indexOf('  share: {')));
    expect(block).toMatch(/cannot change anything, approve anything or move any money/);
  });

  it('the owner is told what they are handing over', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  projectShare: {'), en.indexOf('\n  },', en.indexOf('  projectShare: {')));
    expect(block).toMatch(/They cannot approve work, move money or invite anybody/);
  });

  it('the panel shows whether each person has actually opened it', () => {
    expect(panel).toMatch(/v\.acceptedAt \? t\('projectShare\.accepted'\) : t\('projectShare\.pending'\)/);
  });
});
