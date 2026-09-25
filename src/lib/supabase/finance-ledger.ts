import { supabase } from './client';
import { listAllPayments } from './payments';
import { ownerLookup } from './admin-users';
import { ledgerLine, byWhen, type LedgerLine, type StageRef } from '@/lib/admin/finance-ledger';

/**
 * Every movement of money, with enough context to read it.
 *
 * Four reads, because PostgREST cannot join `payments → projects → profiles` and the
 * alternative is a round trip per row. A lookup that fails costs a NAME, never a row: a
 * payment with an unreadable project is still a payment, and hiding it would understate
 * what moved.
 */

export interface LedgerData {
  lines: LedgerLine[];
  /** `false` when the ledger itself could not be read — not the same as an empty ledger. */
  available: boolean;
  /** Lookups that failed, so the screen can say why a column is thin. */
  degraded: string[];
}

export async function loadFinanceLedger(): Promise<LedgerData> {
  const payments = await listAllPayments();
  if (!payments.available) return { lines: [], available: false, degraded: [] };

  const degraded: string[] = [];

  const [projectsRes, stagesRes, people] = await Promise.all([
    supabase.from('projects').select('id, name, user_id'),
    supabase.from('project_stages').select('id, stage_number, name'),
    ownerLookup().catch(() => { degraded.push('people'); return new Map<string, { name: string; email: string }>(); }),
  ]);

  const projectName = new Map<string, string>();
  const ownerOf = new Map<string, string>();
  if (projectsRes.error) degraded.push('projects');
  else for (const p of (projectsRes.data ?? []) as Record<string, unknown>[]) {
    projectName.set(String(p.id), String(p.name ?? ''));
    if (typeof p.user_id === 'string') ownerOf.set(String(p.id), p.user_id);
  }

  const stages = new Map<string, StageRef>();
  if (stagesRes.error) degraded.push('stages');
  else for (const s of (stagesRes.data ?? []) as Record<string, unknown>[]) {
    stages.set(String(s.id), {
      id: String(s.id),
      number: typeof s.stage_number === 'number' ? s.stage_number : 0,
      name: String(s.name ?? ''),
    });
  }

  const lines = payments.rows.map(p => ledgerLine(p, {
    projectName: id => projectName.get(id) || null,
    ownerOf: id => ownerOf.get(id) ?? null,
    // A person the account list cannot name is `null`, never a raw id on screen.
    nameOf: id => {
      if (!id) return null;
      const u = people.get(id);
      return (u?.name || u?.email) || null;
    },
    stageOf: id => (id ? stages.get(id) ?? null : null),
  }));

  return { lines: byWhen(lines), available: true, degraded };
}
