import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A client reaches Groundwork by one of two routes, and only one of them worked.
 *
 *   SELF-CREATED  signed up, ran the wizard, owns the `projects` row.
 *   INVITED       a contractor set the build up (166) or the owner shared it (112);
 *                 somebody else owns the row and this person is an accepted viewer.
 *
 * `member_select_projects` (086) has returned the viewer's project since 112, so the
 * server was never the problem. Every client screen asked `projects.user_id = me`, so
 * the invited client was told they had no builds and offered the wizard — on the
 * platform their own house was being tracked on. The only thing that worked for them
 * was the deep link in their invitation email.
 *
 * What these tests hold:
 *   · the two sets are fetched, and kept apart
 *   · every client surface asks for both
 *   · the screens stop offering an invited client actions the server refuses — 088
 *     refuses their site update by name, and there is no project for them to create
 */

// ── The query ────────────────────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  viewers:  [] as Record<string, unknown>[],
  errors:   new Map<string, { code: string; message: string }>(),
  from:     vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

beforeEach(() => {
  db.projects = [];
  db.viewers  = [];
  db.errors.clear();
  db.from.mockReset().mockImplementation((table: string) => {
    let rows = (table === 'projects' ? db.projects : db.viewers).slice();
    const result = () => {
      const err = db.errors.get(table);
      return Promise.resolve(err ? { data: null, error: err } : { data: rows, error: null });
    };
    const query = {
      select: () => query,
      eq:  (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return query; },
      in:  (k: string, v: unknown[]) => { rows = rows.filter(r => v.includes(r[k] as never)); return query; },
      is:  (k: string, _v: null) => { rows = rows.filter(r => r[k] == null); return query; },
      not: (k: string, _op: string, _v: null) => { rows = rows.filter(r => r[k] != null); return query; },
      order: () => result(),
      then: (...args: Parameters<Promise<unknown>['then']>) => result().then(...args),
    };
    return query;
  });
});

const project = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: 'owner', name: id, status: 'active',
  created_at: '2026-01-01T00:00:00Z', ...over,
});

const invite = (projectId: string, over: Record<string, unknown> = {}) => ({
  project_id: projectId, user_id: 'me',
  accepted_at: '2026-02-01T00:00:00Z', revoked_at: null, ...over,
});

async function load(userId = 'me') {
  const { fetchClientProjects } = await import('@/lib/supabase/projects');
  return fetchClientProjects(userId);
}

describe('fetchClientProjects finds both kinds of build', () => {
  it('returns a build somebody else owns and invited this person onto', async () => {
    db.projects = [project('shared-1')];
    db.viewers  = [invite('shared-1')];

    const out = await load();
    expect(out.owned).toHaveLength(0);
    expect(out.shared.map(p => p.id)).toEqual(['shared-1']);
    expect(out.all.map(p => p.id)).toEqual(['shared-1']);
    expect(out.isShared('shared-1')).toBe(true);
  });

  it('still returns the ones they created, alongside', async () => {
    db.projects = [project('mine', { user_id: 'me', created_at: '2026-03-01T00:00:00Z' }),
                   project('theirs')];
    db.viewers  = [invite('theirs')];

    const out = await load();
    expect(out.owned.map(p => p.id)).toEqual(['mine']);
    expect(out.shared.map(p => p.id)).toEqual(['theirs']);
    // Newest first across BOTH, so the list is a list and not two lists stacked.
    expect(out.all.map(p => p.id)).toEqual(['mine', 'theirs']);
    expect(out.isShared('mine')).toBe(false);
  });

  it('ignores an invitation that was never accepted', async () => {
    // The row exists from the moment the email is sent. Until they open the link,
    // `project_member()` does not admit them either — the two must agree.
    db.projects = [project('pending')];
    db.viewers  = [invite('pending', { accepted_at: null, user_id: null })];
    expect((await load()).all).toHaveLength(0);
  });

  it('ignores an invitation that was revoked', async () => {
    db.projects = [project('taken-back')];
    db.viewers  = [invite('taken-back', { revoked_at: '2026-04-01T00:00:00Z' })];
    expect((await load()).all).toHaveLength(0);
  });

  it('ignores somebody else’s invitation', async () => {
    db.projects = [project('not-mine')];
    db.viewers  = [invite('not-mine', { user_id: 'someone-else' })];
    expect((await load()).all).toHaveLength(0);
  });

  it('counts a build they both own and were invited onto exactly once, as owned', async () => {
    // 112 permits it: a contractor who set a project up and was later added as a
    // viewer of it. Owned is the stronger relationship and the one actions hang off,
    // so a duplicate row — or a card that says read-only on their own build — is wrong.
    db.projects = [project('both', { user_id: 'me' })];
    db.viewers  = [invite('both')];

    const out = await load();
    expect(out.all.map(p => p.id)).toEqual(['both']);
    expect(out.shared).toHaveLength(0);
    expect(out.isShared('both')).toBe(false);
  });

  it('degrades to owned-only when 112 is not applied', async () => {
    // A dashboard that will not load because one table is missing is worse than one
    // without the shared builds on it.
    db.projects = [project('mine', { user_id: 'me' })];
    db.errors.set('project_viewers', { code: '42P01', message: 'relation does not exist' });

    const out = await load();
    expect(out.owned.map(p => p.id)).toEqual(['mine']);
    expect(out.shared).toHaveLength(0);
  });
});

// ── The screens ──────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Every screen a signed-in client reaches that lists their builds. Each one keyed on
// `projects.user_id` and so showed an invited client nothing at all.
const CLIENT_SURFACES = [
  'src/app/routes/dashboard.tsx',
  'src/app/routes/projects/index.tsx',
  'src/app/routes/documents.tsx',
  'src/app/routes/payments.tsx',
];

describe('every client surface asks for both kinds', () => {
  for (const file of CLIENT_SURFACES) {
    it(`${file} loads shared builds too`, () => {
      const src = code(file);
      expect(src, 'must load every project relationship').toMatch(/fetch(?:Client|Participant)Projects/);
      // The owned-only query must not be what a client screen reaches for. It is still
      // exported — /profile counts a person's OWN projects against their plan, which is
      // the one question `user_id = me` is the right answer to.
      expect(src).not.toMatch(/\bfetchProjects\s*\(/);
    });
  }

  it('leaves the owned-only query in place for the one caller that wants it', () => {
    expect(code('src/lib/supabase/projects.ts')).toContain('export async function fetchProjects');
    expect(code('src/app/routes/profile.tsx')).toContain('fetchProjects(user.id)');
  });
});

describe('the invited client is not offered what the server will refuse', () => {
  const dash = code('src/app/routes/dashboard.tsx');
  const list = code('src/app/routes/projects/index.tsx');

  it('decides the path on OWNED projects, not on having any at all', () => {
    // Somebody with one build of their own and one shared with them is an ordinary
    // client and keeps every affordance. Only somebody whose builds are ALL somebody
    // else's is on the invited path.
    for (const [file, src] of [['dashboard', dash], ['projects', list]] as const) {
      expect(src, `${file} must test owned, not total`)
        .toContain('ownedCount === 0 && projects.length > 0');
    }
  });

  it('withholds every route to the wizard on that path', () => {
    // Three of them on the dashboard — the header button, the profile tracker whose
    // last item is "First project created", and the dashed strip at the bottom — and
    // two on the list. A client whose contractor owns the build has no project to
    // create and will never finish a tracker that asks for one.
    expect((dash.match(/!viewerOnly/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((list.match(/!viewerOnly/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('counts the profile tracker against owned projects only', () => {
    expect(dash).toContain('hasProject={ownedCount > 0}');
    expect(dash).not.toContain('hasProject={projects.length > 0}');
  });

  it('does not offer a site update on a build they cannot file one against', () => {
    // 088: "only the owner, a contractor or an administrator may submit a site
    // update". A viewer is none of those. The card goes to the Timeline instead —
    // reading what was filed is what they came for.
    expect(dash).toContain("shared && project ? {");
    expect(dash).toContain("?tab=timeline");
    expect(dash).toContain("'dashboard.quick.updates'");
  });

  it('says why, rather than leaving them to infer it from missing buttons', () => {
    expect(dash).toContain("t('dashboard.shared.readOnly')");
    expect(dash).toContain("t('dashboard.shared.badge')");
  });

  it('marks which builds are somebody else’s wherever builds are listed', () => {
    // Documents is excluded on purpose: it is a vault of files filtered by a project
    // picker, not a list of builds. Who owns the build changes nothing about whether a
    // certificate is yours to download, and a badge in a dropdown is noise.
    for (const file of CLIENT_SURFACES.filter(f => !f.endsWith('documents.tsx'))) {
      expect(code(file), `${file} must mark a shared build`).toContain('dashboard.shared.badge');
    }
  });
});

describe('shared is derived from the shared list, never from the whole list', () => {
  it('the id set is built from `shared`', () => {
    // `new Set(all.map(...))` would mark every build read-only, including their own.
    for (const file of ['src/app/routes/dashboard.tsx',
                        'src/app/routes/projects/index.tsx',
                        'src/app/routes/payments.tsx']) {
      expect(code(file), file).toContain('setSharedIds(new Set(shared.map(p => p.id)))');
    }
  });

  it('a contractor is never marked as a viewer of their own work', () => {
    // The contractor branch builds the same shape by hand; its shared list is empty
    // because a contractor reaches a project through an accepted invitation, which is
    // not a viewer row.
    for (const file of ['src/app/routes/dashboard.tsx',
                        'src/app/routes/projects/index.tsx',
                        'src/app/routes/payments.tsx']) {
      if (file.endsWith('payments.tsx')) {
        expect(code(file), file).toMatch(/fetchContractorProjects\(user\.id\)\.then\(rows => \(\{[^}]*shared: \[\]/);
      } else {
        expect(code(file), file).toContain('fetchParticipantProjects(user.id, isContractor)');
        expect(code('src/lib/supabase/participant-projects.ts')).toContain('client.shared.filter(p => !assignedIds.has(p.id))');
      }
    }
  });
});
