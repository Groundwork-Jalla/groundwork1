import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, CLIENT_NAV, pageTitleKey } from './nav-config';

/**
 * The sidebar is data, and data can point at nothing.
 *
 * A nav item whose `to` has no route renders fine, highlights fine, and 404s on click —
 * tsc cannot see it, because `to` is a string. This reads the route table and checks.
 * Added when the admin nav was regrouped (12 Sep 2026), which is exactly the kind of
 * edit that drops or mistypes a path.
 */

const routesSource = readFileSync(resolve(__dirname, '../../app/routes.ts'), 'utf8');

/** Every literal path in routes.ts, with a leading slash. `route("admin/crm", …)` → `/admin/crm`. */
const declared = new Set(
  [...routesSource.matchAll(/route\(\s*"([^"]+)"/g)].map(m => (m[1].startsWith('/') ? m[1] : `/${m[1]}`)),
);

describe('nav points at real routes', () => {
  for (const item of [...CLIENT_NAV, ...ADMIN_NAV]) {
    it(`${item.to} is declared in routes.ts`, () => {
      expect(declared.has(item.to), `no route for ${item.to}`).toBe(true);
    });
  }
});

describe('admin nav shape', () => {
  it('leads with the overview and the two review queues (mobile tab bar takes the first five)', () => {
    expect(ADMIN_NAV.slice(0, 3).map(i => i.to)).toEqual(['/admin', '/admin/reviews', '/admin/budgets']);
  });

  it('every admin page is reachable from the sidebar', () => {
    const adminRoutes = [...declared].filter(p => p.startsWith('/admin') && !p.includes(':'));
    // These are reached from inside other pages, not the sidebar.
    const notInNav = new Set(['/admin/login', '/admin/projects/new', '/admin/users/new']);
    for (const r of adminRoutes) {
      if (notInNav.has(r)) continue;
      expect(ADMIN_NAV.some(i => i.to === r), `${r} has no sidebar entry`).toBe(true);
    }
  });

  it('sections are contiguous — a heading is printed once, above its first item', () => {
    // AppSidebar prints a heading when `section` differs from the previous item's, so an
    // item that re-uses an earlier section later in the list would print it twice.
    const seen = new Set<string>();
    let current: string | undefined;
    for (const item of ADMIN_NAV) {
      const s = item.section ?? current;
      if (s !== current) {
        expect(seen.has(s ?? ''), `section ${s} appears twice`).toBe(false);
        if (s) seen.add(s);
        current = s;
      }
    }
  });

  it('the client nav has no sections, so the client sidebar renders exactly as before', () => {
    expect(CLIENT_NAV.every(i => i.section === undefined)).toBe(true);
  });
});

describe('pageTitleKey', () => {
  it('ignores sections and still picks the longest match', () => {
    expect(pageTitleKey('/admin/applications/abc', ADMIN_NAV)).toBe('nav.applications');
    expect(pageTitleKey('/admin', ADMIN_NAV)).toBe('nav.overview');
  });
});
