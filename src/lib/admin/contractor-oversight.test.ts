import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignmentsFor, acceptedProjectIds, verificationContext, updatesFor, paymentsFor,
  matchesQuery, norm,
  type InviteRow, type ProjectRow, type VerificationRow, type UpdateRow, type PaymentRow,
} from './contractor-oversight';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Slice 15. The standing rule is "admin manages the actor; admin does not become the
 * actor", and the second risk is a performance number nobody can source: `contractors`
 * carries `rating`, `review_count` and `completed_projects`, and not one of the three
 * means what its name says.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const panel = code('src/components/admin/ContractorOversight.tsx');
const page  = code('src/app/routes/admin/contractors.tsx');
const loader = code('src/lib/supabase/contractor-oversight.ts');

const inv = (o: Partial<InviteRow> = {}): InviteRow => ({
  projectId: 'j1', email: 'build@co.cm', status: 'accepted',
  acceptedAt: '2026-03-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z', ...o,
});
const projects = new Map<string, ProjectRow>([
  ['j1', { id: 'j1', name: 'House of Lux', status: 'active', currentStage: 3 }],
  ['j2', { id: 'j2', name: 'Villa Two', status: 'active', currentStage: 1 }],
]);

describe('assignments come from accepted invites, matched on the assigning identifier', () => {
  it('finds the contractor\'s own projects and nobody else\'s', () => {
    const rows = assignmentsFor('build@co.cm', [
      inv({ projectId: 'j1' }),
      inv({ projectId: 'j2', email: 'someone@else.cm' }),
    ], projects);
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe('j1');
  });

  it('matches case and whitespace, and nothing else', () => {
    expect(norm('  Build@CO.cm ')).toBe('build@co.cm');
    expect(assignmentsFor(' BUILD@co.CM ', [inv()], projects)).toHaveLength(1);
    // A name is never a key. No email, no assignments.
    expect(assignmentsFor(null, [inv()], projects)).toEqual([]);
    expect(assignmentsFor('', [inv()], projects)).toEqual([]);
  });

  it('keeps a pending invite, labelled, and drops a rejected one', () => {
    const rows = assignmentsFor('build@co.cm', [
      inv({ projectId: 'j1', status: 'pending' }),
      inv({ projectId: 'j2', status: 'rejected' }),
    ], projects);
    expect(rows.map(r => r.status)).toEqual(['pending']);
    expect(page).not.toContain('rejected');
  });

  it('only accepted projects scope everything downstream', () => {
    const rows = assignmentsFor('build@co.cm', [
      inv({ projectId: 'j1', status: 'accepted' }),
      inv({ projectId: 'j2', status: 'pending' }),
    ], projects);
    expect([...acceptedProjectIds(rows)]).toEqual(['j1']);
  });
});

describe('verification history is context and is never called performance', () => {
  const verifications: VerificationRow[] = [
    { projectId: 'j1', decision: 'rejected', decidedAt: null },
    { projectId: 'j1', decision: 'verified', decidedAt: null },
    { projectId: 'j2', decision: 'rejected', decidedAt: null },
  ];

  it('counts only decisions on projects they accepted', () => {
    const accepted = new Set(['j1']);
    const ctx = verificationContext(accepted, verifications, [inv()], 'build@co.cm');
    expect(ctx.total).toBe(2);
    expect(ctx.byDecision).toEqual({ rejected: 1, verified: 1 });
  });

  it('flags a project shared with another contractor, because then nothing is attributable', () => {
    const accepted = new Set(['j1']);
    const shared = verificationContext(accepted, verifications, [
      inv({ projectId: 'j1' }),
      inv({ projectId: 'j1', email: 'other@co.cm' }),
    ], 'build@co.cm');
    expect(shared.shared).toBe(true);

    const alone = verificationContext(accepted, verifications, [inv({ projectId: 'j1' })], 'build@co.cm');
    expect(alone.shared).toBe(false);
  });

  it('the screen says it is not a score', () => {
    expect(panel).toContain('notAScore');
    expect(panel).toContain('sharedProjects');
    expect(String(lookup(en, 'admin.oversight.notAScore'))).toMatch(/not a performance measure/i);
    expect(String(lookup(en, 'admin.oversight.verification'))).not.toMatch(/rework|score|rate/i);
  });
});

describe('no metric appears that the schema cannot source', () => {
  it('no rating, score, ranking or rate anywhere on the surface', () => {
    // `notAScore` is the copy that says it is NOT one, and `Banknote` is an icon; both
    // are stripped before the ban so the pin catches a real metric rather than a word.
    const clean = (s: string) => s.replace(/notAScore|Banknote/g, '');
    for (const banned of [
      'rating', 'Rating', 'review_count', 'reviewCount', 'score', 'Score',
      'reliability', 'onTime', 'on-time', 'reworkRate', 'completionRate', 'ranking', 'badge', 'stars',
    ]) {
      expect(clean(panel), `${banned} has nothing behind it`).not.toContain(banned);
      expect(clean(page), `${banned} has nothing behind it`).not.toContain(banned);
    }
  });

  it('completed_projects is relabelled as what 033 actually puts there', () => {
    // 033: completed_projects = jsonb_array_length(application.projects) — self-reported.
    expect(src('supabase/migrations/033_contractor_directory.sql'))
      .toContain('jsonb_array_length(a.projects)');
    expect(page).toContain('listedValue');
    expect(page).not.toContain('projectsValue');
    expect(String(lookup(en, 'admin.dir.listedValue'))).toMatch(/listed on their application/i);
    expect(String(lookup(en, 'admin.dir.listedHint'))).toMatch(/Not work completed on Groundwork/i);
  });
});

describe('attribution needs an account, and says so when there is none', () => {
  const updates: UpdateRow[] = [
    { projectId: 'j1', submittedBy: 'u1', submittedAt: '2026-05-01T00:00:00Z' },
    { projectId: 'j1', submittedBy: 'u2', submittedAt: '2026-05-02T00:00:00Z' },
    { projectId: 'j9', submittedBy: 'u1', submittedAt: '2026-05-03T00:00:00Z' },
  ];

  it('site updates are theirs only if their account filed them on their project', () => {
    expect(updatesFor('u1', new Set(['j1']), updates)).toHaveLength(1);
    // No account: nothing is attributed rather than everything on the project.
    expect(updatesFor(null, new Set(['j1']), updates)).toEqual([]);
    expect(panel).toContain('noAccount');
  });

  it('payments are only outbound rows naming them as beneficiary', () => {
    const payments: PaymentRow[] = [
      { projectId: 'j1', beneficiaryId: 'u1', direction: 'out', state: 'settled', amount: 100, currency: 'USD', createdAt: null },
      { projectId: 'j1', beneficiaryId: 'u2', direction: 'out', state: 'settled', amount: 200, currency: 'USD', createdAt: null },
      { projectId: 'j1', beneficiaryId: null, direction: 'in',  state: 'settled', amount: 900, currency: 'USD', createdAt: null },
    ];
    const mine = paymentsFor('u1', payments);
    expect(mine).toHaveLength(1);
    expect(mine[0].amount).toBe(100);
    expect(paymentsFor(null, payments)).toEqual([]);
  });

  it('no bank details, no provider, no custody language', () => {
    for (const banned of [
      'iban', 'IBAN', 'account_number', 'accountNumber', 'bank', 'Bank',
      'swychr', 'SwyChr', 'Switchr', 'provider_ref', 'wallet', 'Wallet', 'escrow', 'Escrow', 'payout',
    ]) {
      expect(panel.replace(/Banknote/g, ''), `${banned} must not appear`).not.toContain(banned);
    }
    expect(loader).not.toContain('provider_payload');
    expect(String(lookup(en, 'admin.oversight.paymentsNote'))).toMatch(/does not hold the funds/i);
  });
});

describe('unavailable is never zero', () => {
  it('each domain can be null independently', () => {
    expect(loader).toMatch(/invites: invRes\.error \? null/);
    expect(loader).toMatch(/verifications: verRes\.error \? null/);
    expect(loader).toMatch(/updates: updRes\.error \? null/);
    expect(loader).toMatch(/payments: payRes\.error \? null/);
    expect(panel).toContain('=== null ? <Unavailable />');
    expect(lookup(en, 'admin.oversight.domainUnavailable')).toBeTypeOf('string');
  });

  it('"not assigned" and "could not read assignments" are different answers', () => {
    expect(panel).toContain('noAssignments');
    expect(panel).toContain('model.assignments === null');
  });
});

describe('admin manages the actor and never becomes one', () => {
  it('imports nothing from the contractor execution surface', () => {
    for (const banned of ['/work', 'contractor-work', 'routes/work', 'CONTRACTOR_TABS']) {
      expect(panel, `${banned} is the contractor's own surface`).not.toContain(banned);
      expect(page, `${banned} is the contractor's own surface`).not.toContain(banned);
    }
  });

  it('calls no execution or decision RPC', () => {
    for (const banned of [
      'submitSiteUpdate', 'approveStage', 'recordVerification', 'record_decision',
      'complete_stage', 'authorisePayment', 'authorise_payment', 'rpc(',
    ]) {
      expect(panel, `${banned} would let an admin act as somebody else`).not.toContain(banned);
    }
    // The panel is reads and links only.
    for (const banned of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(panel, banned).not.toContain(banned);
      expect(loader, banned).not.toContain(banned);
    }
  });

  it('creates no second contractor record', () => {
    expect(panel).not.toContain("from('contractors')");
    expect(loader).not.toContain("from('contractors')");
  });
});

describe('the URL drives the one search the page has', () => {
  it('?q= is read from the URL, and the box writes to it', () => {
    expect(page).toContain("params.get('q')");
    expect(page).toContain("put('q', v)");
    expect(page).toContain('useSearchParams');
  });

  it('there is exactly one matching implementation, shared', () => {
    expect(page).toContain('matchesQuery');
    // The old inline filter is gone, so the URL and the box cannot diverge.
    expect(page).not.toMatch(/\[r\.name, r\.location, r\.email/);
  });

  it('matchesQuery looks at the fields a person would type', () => {
    const row = { name: 'Atangana Build', trade: 'mason', location: 'Douala', email: 'a@b.cm', specialties: ['concrete'] };
    for (const q of ['atangana', 'MASON', 'douala', 'a@b', 'concrete', '']) {
      expect(matchesQuery(row, q), q).toBe(true);
    }
    expect(matchesQuery(row, 'yaounde')).toBe(false);
  });

  it('a row expands in place, addressed by the URL like the rest of admin', () => {
    expect(page).toContain("params.get('contractor')");
    expect(page).toContain('ContractorOversight');
  });
});

describe('EN and FR carry every new string', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.oversight.assignments', 'admin.oversight.matchedByEmail', 'admin.oversight.accepted',
      'admin.oversight.invitedNotAccepted', 'admin.oversight.noAssignments',
      'admin.oversight.verification', 'admin.oversight.notAScore', 'admin.oversight.sharedProjects',
      'admin.oversight.siteUpdates', 'admin.oversight.noAccount', 'admin.oversight.payments',
      'admin.oversight.paymentsNote', 'admin.oversight.noPayments', 'admin.oversight.provenance',
      'admin.oversight.noEmail', 'admin.oversight.domainUnavailable',
      'admin.dir.listedValue', 'admin.dir.listedHint',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
