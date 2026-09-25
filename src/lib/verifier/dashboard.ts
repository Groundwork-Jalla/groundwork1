import type { VerifierWorkItem } from '@/lib/supabase/verifier-work';

export type WorkFilter = 'all' | 'pending' | 'visited' | 'findings' | 'recorded';

export function matchesWorkFilter(row: VerifierWorkItem, filter: WorkFilter, now: Date): boolean {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const week = new Date(today); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  switch (filter) {
    case 'pending': return row.decision === 'pending';
    case 'findings': return row.decision === 'pending' && row.visitedAt !== null;
    case 'visited': {
      const date = row.visitedAt ? new Date(row.visitedAt).getTime() : NaN;
      return date >= today.getTime() && date < tomorrow.getTime();
    }
    case 'recorded': {
      const date = row.decidedAt ? new Date(row.decidedAt).getTime() : NaN;
      return row.decision !== 'pending' && date >= week.getTime() && date <= now.getTime();
    }
    default: return true;
  }
}

export function verifierSummary(rows: VerifierWorkItem[], now: Date) {
  return {
    pending: rows.filter(r => matchesWorkFilter(r, 'pending', now)).length,
    visited: rows.filter(r => matchesWorkFilter(r, 'visited', now)).length,
    findings: rows.filter(r => matchesWorkFilter(r, 'findings', now)).length,
    recorded: rows.filter(r => matchesWorkFilter(r, 'recorded', now)).length,
  };
}

export function searchWork(row: VerifierWorkItem, query: string) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const haystack = normalize([row.projectName, row.stageName, row.projectCity, row.projectCountry, row.id, row.projectId].join(' '));
  return normalize(query).trim().split(/\s+/).every(term => haystack.includes(term));
}
