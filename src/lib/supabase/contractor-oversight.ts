import { supabase } from './client';
import type { InviteRow, ProjectRow, VerificationRow, UpdateRow, PaymentRow } from '@/lib/admin/contractor-oversight';

/**
 * Everything an admin may see ABOUT a contractor — never anything they may do AS one.
 *
 * Five reads, each independently unavailable. A table behind a later migration (087
 * verifications, 088 site updates, 090 payments) may simply not be there; that is
 * reported as `null` for the domain and rendered as "not available", which is a
 * different fact from "none" and must never collapse into a zero.
 */
export interface OversightData {
  invites: InviteRow[] | null;
  projects: Map<string, ProjectRow>;
  verifications: VerificationRow[] | null;
  updates: UpdateRow[] | null;
  payments: PaymentRow[] | null;
  /** The contractor's Groundwork account, matched on the address 029 assigns by. */
  personId: string | null;
  personKnown: boolean;
}

const s  = (v: unknown) => (typeof v === 'string' ? v : null);
const missing = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205';
};

export async function loadContractorOversight(email: string | null): Promise<OversightData> {
  const key = (email ?? '').trim().toLowerCase();

  const [invRes, projRes, verRes, updRes, payRes, personRes] = await Promise.all([
    supabase.from('contractor_invites').select('project_id, email, status, accepted_at, created_at'),
    supabase.from('projects').select('id, name, status, current_stage'),
    supabase.from('stage_verifications').select('project_id, decision, decided_at'),
    supabase.from('site_updates').select('project_id, submitted_by, submitted_at'),
    supabase.from('payments').select('project_id, beneficiary_id, direction, state, amount, currency, created_at'),
    key ? supabase.from('profiles').select('id').ilike('email', key).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
  ]);

  const projects = new Map<string, ProjectRow>();
  if (!projRes.error) {
    for (const p of (projRes.data ?? []) as Record<string, unknown>[]) {
      projects.set(String(p.id), {
        id: String(p.id), name: String(p.name ?? ''),
        status: s(p.status), currentStage: typeof p.current_stage === 'number' ? p.current_stage : null,
      });
    }
  }

  return {
    invites: invRes.error ? null : ((invRes.data ?? []) as Record<string, unknown>[]).map(i => ({
      projectId: String(i.project_id), email: String(i.email ?? ''),
      status: String(i.status ?? 'pending') as InviteRow['status'],
      acceptedAt: s(i.accepted_at), createdAt: s(i.created_at),
    })),
    projects,
    verifications: verRes.error ? null : ((verRes.data ?? []) as Record<string, unknown>[]).map(v => ({
      projectId: String(v.project_id), decision: String(v.decision ?? ''), decidedAt: s(v.decided_at),
    })),
    updates: updRes.error ? null : ((updRes.data ?? []) as Record<string, unknown>[]).map(u => ({
      projectId: String(u.project_id), submittedBy: s(u.submitted_by), submittedAt: s(u.submitted_at),
    })),
    payments: payRes.error ? null : ((payRes.data ?? []) as Record<string, unknown>[]).map(p => ({
      projectId: s(p.project_id), beneficiaryId: s(p.beneficiary_id),
      direction: String(p.direction ?? ''), state: String(p.state ?? ''),
      amount: Number(p.amount ?? 0), currency: s(p.currency), createdAt: s(p.created_at),
    })),
    // An unreadable profiles table is not "they have no account": `personKnown` says
    // which of the two it was, so the evidence and payment panels can say so too.
    personId: personRes.error ? null : (personRes.data as { id?: string } | null)?.id ?? null,
    personKnown: !personRes.error && !missing(personRes.error),
  };
}
