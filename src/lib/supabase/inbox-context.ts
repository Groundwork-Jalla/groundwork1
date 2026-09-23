import { supabase } from './client';

/**
 * Who a conversation is with, and what Groundwork is building for them (06 §19 D).
 *
 * ── Why this is not "the conversation's project" ─────────────────────────────────────
 * A WhatsApp thread arrives with a person and no project — 091 links one only when
 * somebody says so. But the admin answering it still needs the context: this is the
 * client on House of Lux, stage 3. So projects are loaded for the PERSON, and the
 * distinction is kept visible:
 *
 *   linked   `conversations.project_id` — somebody said this thread is about that project
 *   account  the person owns it; nobody has said the conversation is about it
 *
 * Inference never writes. A thread with two projects shows both and asks; a thread with
 * one shows it as the account's, not as the conversation's. Groundwork does not pretend
 * to know which build a "Hi" is about.
 */

export interface InboxProject {
  id: string;
  name: string;
  status: string | null;
  tier: string | null;
  currentStage: number | null;
  country: string | null;
  city: string | null;
}

export interface PersonContext {
  personId: string;
  projects: InboxProject[];
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Every project owned by any of these people, in one read. Admin-only by RLS (009); a
 * person with no project simply has no rows, which is the honest answer, not an error.
 */
export async function listProjectsForPeople(personIds: string[]): Promise<{ byPerson: Map<string, InboxProject[]>; available: boolean }> {
  const byPerson = new Map<string, InboxProject[]>();
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length === 0) return { byPerson, available: true };

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, user_id, status, tier, current_stage, country, city')
    .in('user_id', ids)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) {
    if ((error as { code?: string }).code === '42P01') return { byPerson, available: false };
    throw error;
  }

  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const owner = s(r.user_id);
    if (!owner) continue;
    const list = byPerson.get(owner) ?? [];
    list.push({
      id:           s(r.id),
      name:         s(r.name),
      status:       sn(r.status),
      tier:         sn(r.tier),
      currentStage: typeof r.current_stage === 'number' ? r.current_stage : null,
      country:      sn(r.country),
      city:         sn(r.city),
    });
    byPerson.set(owner, list);
  }
  return { byPerson, available: true };
}
