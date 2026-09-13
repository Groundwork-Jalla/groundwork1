import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KPI_LINKS, SEE_ALL_LINKS } from './overview-links';
import { PROJECT_HEALTH_FILTERS, parseHealthFilter, parseStatusFilter, matchesStatusFilter } from './project-filters';
import { ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';

/**
 * NO DEAD QUERY PARAMETERS.
 *
 * A KPI that links to `/admin/projects?health=at_risk` and lands on all 22 projects is
 * worse than one that does not link at all: the admin reads the list as the answer to the
 * number they clicked. tsc cannot see it — `to` is a string and so is the query — and a
 * browser check catches it only for the route someone remembered to click.
 *
 * So this opens the destination's own route file and insists the parameter is read there.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const routesSource = readFileSync(resolve(ROOT, 'src/app/routes.ts'), 'utf8');

/** `/admin/projects` → `src/app/routes/admin/projects.tsx`, from routes.ts itself. */
const FILE_FOR = new Map(
  [...routesSource.matchAll(/route\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)]
    .map(m => [m[1].startsWith('/') ? m[1] : `/${m[1]}`, `src/app/${m[2]}`] as const),
);

function source(path: string): string {
  const file = FILE_FOR.get(path);
  if (!file) throw new Error(`no route declares ${path}`);
  return readFileSync(resolve(ROOT, file), 'utf8');
}

const ALL_LINKS = [
  ...Object.entries(KPI_LINKS).map(([k, v]) => [`KPI_LINKS.${k}`, v] as const),
  ...Object.entries(SEE_ALL_LINKS)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => [`SEE_ALL_LINKS.${k}`, v as string] as const),
];

describe('every Overview destination is a real page', () => {
  for (const [name, link] of ALL_LINKS) {
    it(`${name} → ${link}`, () => {
      const path = link.split('?')[0];
      const placeheld = ADMIN_PLACEHOLDERS[path.replace('/admin/', '')] !== undefined;
      expect(FILE_FOR.has(path) || placeheld, `${path} has neither a route nor a placeholder`).toBe(true);
    });
  }
});

describe('every parameter an Overview link carries is actually read', () => {
  for (const [name, link] of ALL_LINKS) {
    const [path, query] = link.split('?');
    if (!query) continue;
    const params = [...new URLSearchParams(query).keys()];
    for (const param of params) {
      it(`${name}: ${path} reads "${param}"`, () => {
        // The Inbox is not built (Phase 6). Its placeholder is an honest "not yet", not a
        // filtered list, and this test must not pretend otherwise — but it must also not
        // let the exemption spread, so the path is named.
        if (path === '/admin/inbox') {
          expect(ADMIN_PLACEHOLDERS['inbox'], 'inbox must still be an honest placeholder').toBeDefined();
          return;
        }
        expect(source(path)).toContain(`params.get('${param}')`);
      });
    }
  }
});

describe('the Overview and its destinations share one definition', () => {
  it('"at risk" is a health band the projects filter recognises', () => {
    expect(KPI_LINKS.atRisk).toContain('health=at_risk');
    expect(parseHealthFilter('at_risk')).toBe('at_risk');
    expect(PROJECT_HEALTH_FILTERS).toContain('at_risk');
  });

  it('"total projects" means the same exclusion on both sides', () => {
    // The Overview counts `.neq('status', 'archived')`; the destination filters the same.
    expect(readFileSync(resolve(ROOT, 'src/lib/supabase/admin-overview.ts'), 'utf8'))
      .toContain(".neq('status', 'archived')");
    expect(KPI_LINKS.totalProjects).toContain('status=not_archived');
    expect(matchesStatusFilter('archived', 'not_archived')).toBe(false);
    expect(matchesStatusFilter('active', 'not_archived')).toBe(true);
    expect(matchesStatusFilter('on_hold', 'not_archived')).toBe(true);
  });

  it('"pending applications" is the status the Overview counted', () => {
    expect(KPI_LINKS.applications).toContain('status=pending');
    expect(readFileSync(resolve(ROOT, 'src/lib/supabase/admin-overview.ts'), 'utf8'))
      .toContain("count('contractor_applications', q => q.eq('status', 'pending'))");
  });

  it('"quote requests" is the status the Overview counted', () => {
    expect(KPI_LINKS.quoteRequests).toContain('status=open');
    expect(readFileSync(resolve(ROOT, 'src/lib/supabase/admin-overview.ts'), 'utf8'))
      .toContain("count('contractor_inquiries', q => q.eq('status', 'open'))");
  });

  it('a page that IS its metric carries no parameter to fake one', () => {
    // /admin/reviews only ever loads stages in pending_review, and /admin/budgets only
    // Management projects with no tracking_started_at. A `?status=` on either would
    // change nothing, which is the dead parameter this file exists to forbid.
    expect(KPI_LINKS.pendingReviews).toBe('/admin/reviews');
    expect(KPI_LINKS.pendingBudgets).toBe('/admin/budgets');
    expect(source('/admin/reviews')).toContain(".eq('status', 'pending_review')");
    expect(source('/admin/budgets')).toContain(".is('tracking_started_at', null)");
  });
});

describe('filter parsing refuses anything it does not know', () => {
  it('ignores an unrecognised value rather than emptying the list', () => {
    expect(parseStatusFilter('nonsense')).toBeNull();
    expect(parseStatusFilter(null)).toBeNull();
    expect(parseHealthFilter('nonsense')).toBeNull();
  });

  it('reads every band the health engine can return', () => {
    for (const band of PROJECT_HEALTH_FILTERS) expect(parseHealthFilter(band)).toBe(band);
  });
});
