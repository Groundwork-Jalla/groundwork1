import { supabase } from './client';
import { listAllPayments } from './payments';
import { financialRows, financialTotals, type FinancialTotals } from '@/lib/admin/financial-operations';

/**
 * Admin analytics — aggregates of what Groundwork already holds (01 §3 ANALYTICS).
 *
 * ── Counts, not trends ───────────────────────────────────────────────────────────────
 * Every number here is a count or a sum over rows that exist right now. There is no
 * historical series to compare against — no snapshot table, no daily rollup — so there
 * is no growth percentage, no "up 12% this month", and no chart pretending to show a
 * direction. When the activity model can answer "what was true last month", trends can
 * be added honestly; until then a shape drawn from one data point is decoration.
 *
 * Anything unreadable comes back `null` and must be rendered as "not available", never
 * as zero. The difference matters: zero verifications means nobody has verified
 * anything; null means we could not ask.
 */

export interface Bucket { key: string; count: number }

export interface AdminAnalytics {
  projects: {
    total: number;
    byStatus: Bucket[];
    byTier: Bucket[];
    byStage: Bucket[];
    tracking: number;
  };
  finance: (FinancialTotals & { expected: number }) | null;
  verification: { pending: number; verified: number; rejected: number; needsMore: number } | null;
  communication: { conversations: number; needsReply: number; resolved: number } | null;
  acquisition: { applicationsPending: number; drafts: number; waitlist: number; quoteRequests: number };
  field: { siteUpdates: number; contributors: number } | null;
  support: { open: number };
}

const count = (rows: Record<string, unknown>[], key: string): Bucket[] => {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = typeof r[key] === 'string' || typeof r[key] === 'number' ? String(r[key]) : 'unknown';
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
};

export async function loadAdminAnalytics(): Promise<AdminAnalytics> {
  const head = (table: string, apply?: (q: ReturnType<typeof supabase.from>) => unknown) => {
    const q = supabase.from(table).select('id', { count: 'exact', head: true });
    return (apply ? (apply(q as never) as typeof q) : q);
  };

  const [projectsRes, ledger, verificationsRes, conversationsRes, updatesRes,
         appsRes, draftsRes, waitlistRes, quotesRes, ticketsRes, ownersRes] = await Promise.all([
    supabase.from('projects').select('id, user_id, status, tier, current_stage, tracking_started_at').neq('status', 'archived'),
    listAllPayments().catch(() => ({ rows: [], available: false })),
    supabase.from('stage_verifications').select('decision'),
    supabase.from('conversations').select('status'),
    supabase.from('site_updates').select('submitted_by'),
    head('contractor_applications', q => (q as never as { eq: (a: string, b: string) => unknown }).eq('status', 'pending')),
    head('contractor_application_drafts'),
    head('waitlist_emails'),
    head('contractor_inquiries', q => (q as never as { eq: (a: string, b: string) => unknown }).eq('status', 'open')),
    head('support_tickets', q => (q as never as { in: (a: string, b: string[]) => unknown }).in('status', ['open', 'in_progress'])),
    supabase.from('projects').select('id, name, user_id, status, tier, budget_usd').neq('status', 'archived'),
  ]);

  if (projectsRes.error) throw projectsRes.error;
  const projects = (projectsRes.data ?? []) as unknown as Record<string, unknown>[];

  // Finance: the same aggregation the Budgets page shows, so the two can never disagree.
  let finance: AdminAnalytics['finance'] = null;
  if (ledger.available && !ownersRes.error) {
    const rows = financialRows(
      ((ownersRes.data ?? []) as unknown as Record<string, unknown>[]).map(p => ({
        id: String(p.id), name: String(p.name ?? ''), ownerName: '',
        status: typeof p.status === 'string' ? p.status : null,
        tier: typeof p.tier === 'string' ? p.tier : null,
        budgetUsd: p.budget_usd == null ? null : Number(p.budget_usd),
      })),
      ledger.rows,
    );
    finance = { ...financialTotals(rows), expected: rows.reduce((a, r) => a + r.expected, 0) };
  }

  const verificationRows = verificationsRes.error ? null : ((verificationsRes.data ?? []) as Record<string, unknown>[]);
  const conversationRows = conversationsRes.error ? null : ((conversationsRes.data ?? []) as Record<string, unknown>[]);
  const updateRows       = updatesRes.error       ? null : ((updatesRes.data ?? []) as Record<string, unknown>[]);
  const num = (r: { count: number | null; error: unknown }) => (r.error ? 0 : (r.count ?? 0));

  return {
    projects: {
      total: projects.length,
      byStatus: count(projects, 'status'),
      byTier: count(projects, 'tier'),
      byStage: count(projects, 'current_stage').sort((a, b) => Number(a.key) - Number(b.key)),
      tracking: projects.filter(p => p.tracking_started_at != null).length,
    },
    finance,
    verification: verificationRows && {
      pending:   verificationRows.filter(v => v.decision === 'pending').length,
      verified:  verificationRows.filter(v => v.decision === 'verified').length,
      rejected:  verificationRows.filter(v => v.decision === 'rejected').length,
      needsMore: verificationRows.filter(v => v.decision === 'needs_more_evidence').length,
    },
    communication: conversationRows && {
      conversations: conversationRows.length,
      needsReply:    conversationRows.filter(c => c.status === 'waiting_on_us').length,
      resolved:      conversationRows.filter(c => c.status === 'resolved').length,
    },
    acquisition: {
      applicationsPending: num(appsRes as never),
      drafts:              num(draftsRes as never),
      waitlist:            num(waitlistRes as never),
      quoteRequests:       num(quotesRes as never),
    },
    field: updateRows && {
      siteUpdates:  updateRows.length,
      contributors: new Set(updateRows.map(u => String(u.submitted_by ?? '')).filter(Boolean)).size,
    },
    support: { open: num(ticketsRes as never) },
  };
}
