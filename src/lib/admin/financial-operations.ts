import { availableFunds } from '@/lib/lifecycle/stage';
import type { Payment } from '@/lib/supabase/payments';

// =========================================================
// Financial operations, across every project (01 §3, "Payments & Budgets") — pure.
//
// ── What this is, and is not ─────────────────────────────────────────────────────────
// Groundwork's business state: what a build should cost, what has been funded, what an
// administrator has authorised for release, what is in transit, what has landed, what
// failed. It is NOT the provider's execution record — no provider reference, no provider
// status, no settlement detail. That belongs to whoever moves the money, and never
// becomes the system of record for a project's finances.
//
// Every figure is a sum over `payments` rows (090). Nothing is estimated, and a project
// with no ledger rows reports zeros with `hasLedger: false` so the screen can say
// "nothing recorded" rather than "$0 funded".
// =========================================================

export interface ProjectFinancialRow {
  projectId: string;
  projectName: string;
  ownerName: string;
  status: string | null;
  tier: string | null;
  /** `projects.budget_usd` — null when the budget has never been confirmed. */
  budgetUsd: number | null;
  funded: number;
  authorised: number;
  inTransit: number;
  disbursed: number;
  failed: number;
  reconciling: number;
  /** funded − everything out that has not failed: what could still be released. */
  available: number;
  /** Tranches expected but not yet funded — the money the build is waiting on. */
  expected: number;
  /** False when this project has no ledger row at all. */
  hasLedger: boolean;
  /** Worst thing needing a person on this project, or null. */
  attention: 'failed' | 'reconciling' | 'authorised' | null;
}

export interface FinancialTotals {
  budget: number;
  funded: number;
  authorised: number;
  inTransit: number;
  disbursed: number;
  needsAttention: number;
}

export interface FinancialProject {
  id: string;
  name: string;
  ownerName: string;
  status: string | null;
  tier: string | null;
  budgetUsd: number | null;
}

/** One row per project, ordered by what needs a person first. */
export function financialRows(projects: FinancialProject[], payments: Payment[]): ProjectFinancialRow[] {
  const byProject = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = byProject.get(p.projectId) ?? [];
    list.push(p);
    byProject.set(p.projectId, list);
  }

  const rows = projects.map(project => {
    const mine = byProject.get(project.id) ?? [];
    const sum = (pred: (p: Payment) => boolean) => mine.filter(pred).reduce((a, p) => a + p.amount, 0);

    const failed      = sum(p => p.direction === 'out' && p.state === 'failed');
    const reconciling = sum(p => p.direction === 'out' && p.state === 'reconciling');
    const authorised  = sum(p => p.direction === 'out' && p.state === 'release_authorised');

    return {
      projectId:   project.id,
      projectName: project.name,
      ownerName:   project.ownerName,
      status:      project.status,
      tier:        project.tier,
      budgetUsd:   project.budgetUsd,
      funded:      sum(p => p.direction === 'in'  && (p.state === 'funded' || p.state === 'reconciled')),
      authorised,
      inTransit:   sum(p => p.direction === 'out' && p.state === 'initiated'),
      disbursed:   sum(p => p.direction === 'out' && p.state === 'disbursed'),
      failed,
      reconciling,
      available:   mine.length > 0 ? availableFunds(mine) : 0,
      expected:    sum(p => p.direction === 'in'  && p.state === 'expected'),
      hasLedger:   mine.length > 0,
      // Worst first: a failed release is money that did not arrive; reconciling is money
      // whose fate is unknown; an authorised release is waiting on execution.
      attention: failed > 0 ? 'failed' : reconciling > 0 ? 'reconciling' : authorised > 0 ? 'authorised' : null,
    } satisfies ProjectFinancialRow;
  });

  const rank = (r: ProjectFinancialRow) =>
    r.attention === 'failed' ? 0 : r.attention === 'reconciling' ? 1 : r.attention === 'authorised' ? 2 : 3;
  return rows.sort((a, b) => rank(a) - rank(b) || b.funded - a.funded || a.projectName.localeCompare(b.projectName));
}

export function financialTotals(rows: ProjectFinancialRow[]): FinancialTotals {
  return {
    budget:     rows.reduce((a, r) => a + (r.budgetUsd ?? 0), 0),
    funded:     rows.reduce((a, r) => a + r.funded, 0),
    authorised: rows.reduce((a, r) => a + r.authorised, 0),
    inTransit:  rows.reduce((a, r) => a + r.inTransit, 0),
    disbursed:  rows.reduce((a, r) => a + r.disbursed, 0),
    needsAttention: rows.filter(r => r.attention !== null).length,
  };
}
