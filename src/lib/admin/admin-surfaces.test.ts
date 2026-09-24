import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { financialRows, financialTotals } from './financial-operations';
import type { Payment } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { ADMIN_NAV, ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';

/**
 * The admin completion sprint (01 §3): Team tab, Clients, Verifiers, Site updates,
 * Notifications, Financial operations.
 *
 * Every one of these is a VIEW over rows that already existed. The pins below are mostly
 * about what they must NOT become: a second record for a person, a copy of an execution
 * surface, an invented count, or a provider leaking into Groundwork's own financial state.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('every new item is a real destination', () => {
  it('the four new pages are routed, in the sidebar, and no longer placeholders', () => {
    const routes = src('src/app/routes.ts'), nav = src('src/components/shell/nav-config.ts');
    for (const [path, file] of [
      ['admin/clients', 'routes/admin/clients.tsx'],
      ['admin/verifiers', 'routes/admin/verifiers.tsx'],
      ['admin/site-updates', 'routes/admin/site-updates.tsx'],
      ['admin/notifications', 'routes/admin/notifications.tsx'],
    ]) {
      expect(routes, path).toContain(`"${path}"`);
      expect(routes, file).toContain(`"${file}"`);
    }
    for (const key of ['clients', 'verifiers', 'site-updates', 'notifications']) {
      expect(ADMIN_PLACEHOLDERS[key], `${key} is built and must not be a placeholder`).toBeUndefined();
    }
    expect(ADMIN_NAV.some(i => i.to === '/admin/verifiers'), 'Verifiers belongs in PEOPLE').toBe(true);
    // The ones with no entity stay honest placeholders.
    for (const key of ['tasks', 'inspections', 'agents', 'site-managers', 'analytics', 'settings']) {
      expect(ADMIN_PLACEHOLDERS[key], `${key} has no entity and must stay a placeholder`).toBeDefined();
    }
    expect(nav).toContain("labelKey: 'nav.verifiers'");
  });

  it('the workspace tab bar no longer advertises anything unbuilt', () => {
    const detail = code('src/app/routes/admin/projects.detail.tsx');
    expect(detail).toContain("tab === 'team' ?");
    expect(code('src/components/admin/workspace/TeamTab.tsx')).toContain('<TeamCard ws={ws}');
  });
});

describe('Clients is a view, not a record', () => {
  const lib = code('src/lib/supabase/admin-clients.ts');
  const page = code('src/app/routes/admin/clients.tsx');

  it('composes profiles + owned projects; there is no clients table', () => {
    expect(lib).toContain('listAdminUsers()');
    expect(lib).toContain("from('projects')");
    expect(lib).not.toMatch(/from\('clients'\)|\.insert\(|\.update\(|\.rpc\(/);
  });

  it('staff and verifiers are excluded by ROLE, never by guesswork', () => {
    expect(lib).toContain("r === 'admin' || r === 'verifier'");
    expect(lib).toContain('users.filter(u => !isStaff(u))');
  });

  it('support tickets go through their own module — the one that throws', () => {
    expect(lib).toContain('listOpenSupportTickets()');
    expect(lib).not.toContain("from('support_tickets')");
  });

  it('unavailable is not zero: a missing 091 reports null, and the screen says n/a', () => {
    expect(lib).toContain('conversationsAvailable ? (convPer.get(u.id) ?? 0) : null');
    expect(page).toContain("data.conversationsAvailable ? String(client.conversations ?? 0) : t('admin.clients.notAvailable')");
  });

  it('invents nothing: no score, no engagement, no status of its own', () => {
    expect(lib).not.toMatch(/score|engagement|health|rating|activity_level/i);
    expect(page).not.toMatch(/score|engagement|rating/i);
  });

  it('opens the workspace — it is not a copy of the client dashboard', () => {
    expect(page).toContain('to={`/admin/projects/${p.id}`}');
    // Never the client's own surfaces.
    expect(page).not.toMatch(/to=\{?["`]\/dashboard|to=\{`\/projects\//);
  });
});

describe('Verifiers is the management surface, not /verifiers', () => {
  const lib = code('src/lib/supabase/verifiers.ts');
  const page = code('src/app/routes/admin/verifiers.tsx');

  it('reads the role, the profile, the assignments and the workload — and nothing else', () => {
    expect(lib).toContain("from('verifier_profiles')");
    expect(lib).toContain("from('project_verifiers')");
    expect(lib).toContain("from('stage_verifications')");
    expect(lib).toContain("includes('verifier')");
  });

  it('records no finding and offers no execution action', () => {
    expect(page).not.toMatch(/recordVerification|record_verification|p_decision|findings|visitedAt/);
    expect(page).not.toMatch(/\.rpc\(|\.update\(|\.insert\(/);
  });

  it('assignment stays where the work is — one door, not two', () => {
    expect(page).not.toMatch(/assignVerifier|assign_verifier|AssignVerifierModal/);
    expect(page).toContain("t('admin.verifiers.assignHint')");
  });

  it('availability is the column the verifier set, never computed here', () => {
    expect(lib).toContain("typeof p.available === 'boolean' ? p.available : null");
    expect(page).not.toMatch(/rating|score|performance|schedule/i);
  });

  it('a verifier with the role but no profile is said plainly, not shown as empty credentials', () => {
    expect(page).toContain("t('admin.verifiers.noProfile')");
    expect(page).toContain("v.disciplines === null");
  });
});

describe('Site updates is one entity, read across projects', () => {
  const lib = code('src/lib/supabase/site-updates.ts');
  const page = code('src/app/routes/admin/site-updates.tsx');

  it('reuses the 088 table and its row mapper — no second site-update model', () => {
    expect(lib).toContain("from('site_updates')");
    expect((lib.match(/export interface SiteUpdate\b/g) ?? []).length).toBe(1);
    expect(lib).toContain('...row(r)');
  });

  it('names are resolved once for the page, not per row', () => {
    expect(lib).toContain('if (reporterIds.length > 0)');
    expect(lib).toContain('for (const u of await listAdminUsers())');
  });

  it('filters only by fields the table actually has', () => {
    expect(page).toContain("params.get('project')");
    expect(page).toContain("params.get('reporter')");
    // There is no type/category column on site_updates, so there is no such filter.
    expect(page).not.toMatch(/params\.get\('(type|category|severity|status)'\)/);
  });

  it('shows work; it does not approve it', () => {
    expect(page).not.toMatch(/approve|reject|rework|\.rpc\(/i);
    expect(page).toContain("?tab=site-updates");
  });

  it('missing 088 is unavailable, not empty', () => {
    expect(page).toContain("!available ?");
    expect(page).toContain("t('admin.siteUpdates.unavailable')");
  });
});

describe('Notifications shares one source of truth with the bell', () => {
  const page = code('src/app/routes/admin/notifications.tsx');

  it('same rows, same destination resolver, same read-state functions', () => {
    expect(page).toContain('fetchNotifications(user.id, PAGE)');
    expect(page).toContain("import { destinationFor } from '@/components/ui/NotificationBell'");
    expect(page).toContain('markNotificationRead(n.id)');
    expect(page).toContain('markAllNotificationsRead(user.id)');
  });

  it('unread is the column, not a number this page made up', () => {
    expect(page).toContain('(rows ?? []).filter(n => !n.read_at).length');
    expect(page).not.toMatch(/unreadCount\s*=\s*\d|badge\s*=\s*\d/);
  });

  it('a notification with nothing to open says so rather than being a dead click', () => {
    expect(page).toContain("t('admin.notifications.noTarget')");
    expect(page).toContain('const to = destinationFor(n.data);');
  });

  it('invents no categories', () => {
    expect(page).not.toMatch(/category|categories|severity|priority/i);
  });
});

describe('Financial operations: Groundwork business state, no provider', () => {
  const P = (over: Partial<Payment>): Payment => ({
    id: Math.random().toString(36).slice(2), projectId: 'p1', stageId: null, direction: 'in', state: 'funded',
    amount: 100, currency: 'USD', beneficiaryId: null, fundingSource: null, confirmedBy: null, confirmedAt: null,
    authorisedBy: null, authorisedAt: null, note: null, provider: null, providerRef: null, providerStatus: null,
    settledAt: null, failureReason: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  } as Payment);
  const project = (id: string, name: string, budget: number | null = 1000) =>
    ({ id, name, ownerName: 'Owner', status: 'active', tier: 'self_verify', budgetUsd: budget });

  it('sums each state separately and leaves failed money out of what is available', () => {
    const rows = financialRows([project('p1', 'House')], [
      P({ direction: 'in', state: 'funded', amount: 1000 }),
      P({ direction: 'out', state: 'disbursed', amount: 300 }),
      P({ direction: 'out', state: 'failed', amount: 200 }),
      P({ direction: 'out', state: 'release_authorised', amount: 150 }),
    ]);
    expect(rows[0]).toMatchObject({ funded: 1000, disbursed: 300, failed: 200, authorised: 150 });
    // failed money is not spent: 1000 − (300 + 150)
    expect(rows[0].available).toBe(550);
  });

  it('a project with no ledger row reports nothing recorded, not zero funded', () => {
    const rows = financialRows([project('p1', 'House')], []);
    expect(rows[0].hasLedger).toBe(false);
    expect(code('src/components/admin/FinancialOperations.tsx')).toContain("t('admin.finops.noLedger')");
  });

  it('what needs a person comes first: failed, then reconciling, then awaiting release', () => {
    const rows = financialRows(
      [project('a', 'Quiet'), project('b', 'Awaiting'), project('c', 'Reconciling'), project('d', 'Failed')],
      [
        P({ projectId: 'b', direction: 'out', state: 'release_authorised', amount: 10 }),
        P({ projectId: 'c', direction: 'out', state: 'reconciling', amount: 10 }),
        P({ projectId: 'd', direction: 'out', state: 'failed', amount: 10 }),
      ],
    );
    expect(rows.map(r => r.projectName)).toEqual(['Failed', 'Reconciling', 'Awaiting', 'Quiet']);
    expect(financialTotals(rows).needsAttention).toBe(3);
  });

  it('no provider anywhere — not a reference, not a status, not a settlement', () => {
    for (const f of ['src/lib/admin/financial-operations.ts', 'src/components/admin/FinancialOperations.tsx']) {
      const c = code(f);
      expect(c, f).not.toMatch(/providerRef|provider_status|providerStatus|settledAt|swychr|stripe/i);
    }
  });

  it('no custody wording, in either language', () => {
    for (const k of ['title', 'subtitle', 'funded', 'authorised', 'inTransit', 'disbursed']) {
      for (const dict of [en, fr]) {
        expect(String(lookup(dict, `admin.finops.${k}`)), k).not.toMatch(/escrow|wallet|custod|s[ée]questre/i);
      }
    }
  });

  it('reads the ledger and writes nothing', () => {
    const c = code('src/components/admin/FinancialOperations.tsx');
    expect(c).toContain('listAllPayments()');
    expect(c).not.toMatch(/authorise_release|confirm_funding|open_reconciliation|\.rpc\(|\.update\(/);
  });

  it('rows open the project Financials tab — and the ledger list now does too', () => {
    expect(code('src/components/admin/FinancialOperations.tsx')).toContain('to={`/admin/projects/${r.projectId}?tab=financials`}');
    expect(code('src/components/admin/LedgerPanel.tsx')).toContain('to={`/admin/projects/${p.projectId}?tab=financials`}');
  });
});

describe('both dictionaries carry every new string', () => {
  it('and each is translated', () => {
    const keys = [
      'admin.clients.title', 'admin.clients.subtitle', 'admin.clients.noProjects', 'admin.clients.empty',
      'admin.verifiers.title', 'admin.verifiers.noProfile', 'admin.verifiers.assignHint', 'admin.verifiers.empty',
      'admin.siteUpdates.subtitle', 'admin.siteUpdates.unavailable', 'admin.siteUpdates.empty',
      'admin.notifications.title', 'admin.notifications.unread', 'admin.notifications.noTarget', 'admin.notifications.empty',
      'admin.finops.title', 'admin.finops.attention.failed', 'admin.finops.attention.reconciling', 'admin.finops.attention.authorised',
      'admin.workspace.team.historyTitle', 'admin.workspace.team.assignedWhen',
      'nav.verifiers',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      // "Clients" and "Notifications" are the same word in both languages.
      if (!['admin.clients.title', 'admin.notifications.title'].includes(key)) {
        expect(e, `${key} is not translated`).not.toBe(f);
      }
    }
  });
});
