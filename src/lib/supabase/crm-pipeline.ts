import { supabase } from './client';
import {
  buildPipeline, type Lead,
  type PersonRow, type ApplicationRow, type WaitlistRow, type ProjectRow,
} from '@/lib/admin/crm-pipeline';

/**
 * The acquisition pipeline, read from the tables that define it (admin-only by RLS).
 *
 * Five independent reads. A domain that throws is reported as unreadable rather than
 * folded into the result as an absence — "the outbox could not be read" and "nothing was
 * ever queued" are different answers, and only one of them is about the business. The
 * two that the pipeline cannot be built without (`profiles`, `projects`) are the only
 * ones that fail the whole load.
 */
export interface PipelineResult {
  leads: Lead[];
  /** Domains that could not be read at all. Rendered as a warning, never as zero. */
  unreadable: string[];
}

const s  = (v: unknown) => (typeof v === 'string' ? v : null);
const ts = (v: unknown) => (typeof v === 'string' && v ? v : null);

export async function loadPipeline(): Promise<PipelineResult> {
  const [peopleRes, appsRes, waitRes, projRes, outboxRes] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, created_at, country, ghl_contact_id'),
    supabase.from('contractor_applications').select('id, email, full_name, status, created_at, ghl_contact_id'),
    supabase.from('waitlist_emails').select('id, email, created_at, synced_to_ghl'),
    supabase.from('projects').select('id, user_id, created_at'),
    supabase.from('ghl_outbox').select('email, status'),
  ]);

  if (peopleRes.error) throw peopleRes.error;
  if (projRes.error)   throw projRes.error;

  const unreadable: string[] = [];
  const rows = (r: { data: unknown; error: unknown }, name: string): Record<string, unknown>[] | null => {
    if (r.error) { unreadable.push(name); return null; }
    return (r.data ?? []) as Record<string, unknown>[];
  };

  const people: PersonRow[] = ((peopleRes.data ?? []) as Record<string, unknown>[]).map(p => ({
    id: String(p.id), email: s(p.email), fullName: s(p.full_name),
    createdAt: ts(p.created_at), country: s(p.country), ghlContactId: s(p.ghl_contact_id),
  }));

  const appRows = rows(appsRes, 'applications');
  const applications: ApplicationRow[] = (appRows ?? []).map(a => ({
    id: String(a.id), email: s(a.email), fullName: s(a.full_name),
    status: String(a.status ?? ''), createdAt: ts(a.created_at), ghlContactId: s(a.ghl_contact_id),
  }));

  const waitRows = rows(waitRes, 'waitlist');
  const waitlist: WaitlistRow[] = (waitRows ?? [])
    .filter(w => typeof w.email === 'string' && w.email)
    .map(w => ({
      id: String(w.id), email: String(w.email),
      createdAt: ts(w.created_at), syncedToGhl: w.synced_to_ghl === true,
    }));

  const projects: ProjectRow[] = ((projRes.data ?? []) as Record<string, unknown>[]).map(p => ({
    id: String(p.id), userId: s(p.user_id), createdAt: ts(p.created_at),
  }));

  // `null` here travels all the way to the sync column as "unknown".
  let outbox: Map<string, string[]> | null = null;
  if (outboxRes.error) {
    unreadable.push('outbox');
  } else {
    outbox = new Map();
    for (const o of (outboxRes.data ?? []) as Record<string, unknown>[]) {
      const email = typeof o.email === 'string' ? o.email.toLowerCase() : '';
      if (!email) continue;
      outbox.set(email, [...(outbox.get(email) ?? []), String(o.status ?? '')]);
    }
  }

  return { leads: buildPipeline({ people, applications, waitlist, projects, outbox }), unreadable };
}
