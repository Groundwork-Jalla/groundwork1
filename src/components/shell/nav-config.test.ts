import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, ADMIN_PLACEHOLDERS, CLIENT_NAV, pageTitleKey } from './nav-config';

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
  // An admin item may instead be answered by the temporary `admin/:section` placeholder.
  const placeholderRoute = declared.has('/admin/:section');
  for (const item of [...CLIENT_NAV, ...ADMIN_NAV]) {
    it(`${item.to} is declared in routes.ts`, () => {
      // A link may carry a filter (`/admin/inbox?channel=whatsapp`); the route is the path.
      const path = item.to.split('?')[0];
      const viaPlaceholder = placeholderRoute && ADMIN_PLACEHOLDERS[path.replace('/admin/', '')] !== undefined;
      expect(declared.has(path) || viaPlaceholder, `no route for ${item.to}`).toBe(true);
    });
  }
});

describe('admin nav shape', () => {
  it('leads with Overview, Action Center, Projects, Reviews & Approvals, Site Updates (the mobile tab bar takes the first five — IA 01 §2)', () => {
    // Budgets held the fifth place until Finance became its own group and took it. The
    // mobile tab bar is the first five items, so moving an item changes what a phone
    // shows — which is why this is pinned rather than left to be noticed later.
    expect(ADMIN_NAV.slice(0, 5).map(i => i.to)).toEqual(['/admin', '/admin/action-center', '/admin/projects', '/admin/reviews', '/admin/site-updates']);
  });

  it('nine groups, in the IA\u2019s order, with Finance between Work and People', () => {
    // Projects tell us what is being built; Finance tells us what happened to the money
    // for it. It reads in that order, so it sits in that order.
    const sections = ADMIN_NAV.map(i => i.section).filter(Boolean);
    expect(sections).toEqual(['nav.sectionOverview', 'nav.sectionWork', 'nav.sectionFinance', 'nav.sectionPeople', 'nav.sectionCommunication', 'nav.sectionAcquisition', 'nav.sectionSupport', 'nav.sectionAnalytics', 'nav.sectionSystem']);
  });

  it('every unbuilt item has a placeholder entry and every placeholder has a sidebar item — the list is temporary and must not drift', () => {
    const built = new Set([...declared].filter(p => p.startsWith('/admin') && !p.includes(':')));
    for (const item of ADMIN_NAV) {
      // A nav link may carry a filter (the WhatsApp entry is the Inbox, one channel of
      // it). The page it lands on is what must be built.
      const path = item.to.split('?')[0];
      const key = path.replace('/admin/', '');
      if (built.has(path)) expect(ADMIN_PLACEHOLDERS[key], `${item.to} is built but still listed as a placeholder`).toBeUndefined();
      else expect(ADMIN_PLACEHOLDERS[key], `${item.to} has neither a page nor a placeholder`).toBeDefined();
    }
    for (const key of Object.keys(ADMIN_PLACEHOLDERS)) expect(ADMIN_NAV.some(i => i.to.split('?')[0] === `/admin/${key}`), `placeholder ${key} has no sidebar item`).toBe(true);
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
