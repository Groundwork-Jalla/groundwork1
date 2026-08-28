import { supabase } from './client';
import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// Agent requests — the team's brief desk for the agents in .claude/agents/.
//
// A queue, not a runner. Agents execute against the repository, so a developer picks a
// request up and posts the result back here. See migration 054.
// =========================================================

export const AGENT_IDS = [
  'video-producer', 'budget-analyst', 'qs-liaison', 'beta-triage', 'ops-desk',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type RequestStatus = 'new' | 'in_progress' | 'delivered' | 'declined';
export type RequestLanguage = 'en' | 'fr' | 'both';

/**
 * The shape of the deliverable.
 *
 * Driven by the channel, not the content — an investor call wants a deck to send ahead
 * and talk over; a website or a WhatsApp forward wants a video. The requester knows the
 * channel, so the producer honours this rather than inferring it from the brief.
 */
export type OutputFormat = 'mp4' | 'pptx' | 'both';

/**
 * Which agents can be asked for work today.
 *
 * `video-producer` only, to start. The table accepts all five and the form is built to
 * list whatever appears here, so enabling the next one is a single-line change rather
 * than a second page — but shipping them all at once would offer Philip four things
 * nobody has briefed before, and an empty queue teaches us nothing about which he needs.
 */
export const ENABLED_AGENTS: readonly AgentId[] = ['video-producer'];

/**
 * Starting points, so a busy person picks rather than composes.
 *
 * These are a guess at what a construction-tech CEO needs, not a settled taxonomy — the
 * point of shipping six is to find out within a month which two get used. Dropping the
 * rest then is a change here and nothing else, because `preset` is free text in the
 * database precisely so that pruning does not need a migration.
 */
export interface RequestPreset {
  id: string;
  agent: AgentId;
  labelKey: TKey;
  /** Fills the brief so the form opens part-answered rather than blank. */
  hintKey: TKey;
}

export const PRESETS: readonly RequestPreset[] = [
  { id: 'investor_demo',        agent: 'video-producer', labelKey: 'admin.requests.preset.investorDemo',        hintKey: 'admin.requests.preset.investorDemoHint' },
  { id: 'client_explainer',     agent: 'video-producer', labelKey: 'admin.requests.preset.clientExplainer',     hintKey: 'admin.requests.preset.clientExplainerHint' },
  { id: 'contractor_onboarding', agent: 'video-producer', labelKey: 'admin.requests.preset.contractorOnboarding', hintKey: 'admin.requests.preset.contractorOnboardingHint' },
  { id: 'test_instructions',    agent: 'video-producer', labelKey: 'admin.requests.preset.testInstructions',    hintKey: 'admin.requests.preset.testInstructionsHint' },
  { id: 'feature_update',       agent: 'video-producer', labelKey: 'admin.requests.preset.featureUpdate',       hintKey: 'admin.requests.preset.featureUpdateHint' },
  { id: 'social_clip',          agent: 'video-producer', labelKey: 'admin.requests.preset.socialClip',          hintKey: 'admin.requests.preset.socialClipHint' },
  { id: 'custom',               agent: 'video-producer', labelKey: 'admin.requests.preset.custom',              hintKey: 'admin.requests.preset.customHint' },
];

export interface AgentRequestRow {
  id: string;
  requested_by: string | null;
  agent: AgentId;
  preset: string | null;
  title: string;
  audience: string | null;
  goal: string | null;
  channel: string | null;
  language: RequestLanguage;
  output_format: OutputFormat;
  needed_by: string | null;
  notes: string | null;
  status: RequestStatus;
  output_url: string | null;
  output_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewAgentRequest {
  agent: AgentId;
  preset?: string | null;
  title: string;
  audience?: string | null;
  goal?: string | null;
  channel?: string | null;
  language: RequestLanguage;
  outputFormat: OutputFormat;
  neededBy?: string | null;
  notes?: string | null;
}

/**
 * File a request.
 *
 * No `.select()` on the write. The caller already has everything it needs to render the
 * new row optimistically, and reading back turns one round trip into two for no gain —
 * the same reasoning as contractor-applications.ts, minus the RLS trap, since anyone who
 * can insert here can also read.
 */
export async function createAgentRequest(req: NewAgentRequest): Promise<string> {
  const id = crypto.randomUUID();
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.from('agent_requests').insert({
    id,
    requested_by: auth.user?.id ?? null,
    agent:      req.agent,
    preset:     req.preset ?? null,
    title:      req.title.trim(),
    audience:   req.audience?.trim() || null,
    goal:       req.goal?.trim() || null,
    channel:    req.channel?.trim() || null,
    language:      req.language,
    output_format: req.outputFormat,
    needed_by:     req.neededBy || null,
    notes:      req.notes?.trim() || null,
  });
  if (error) throw error;
  return id;
}

/**
 * The queue, open work first.
 *
 * Sorted by status rather than by date alone: a request filed this morning that is still
 * `new` matters more than one delivered last week, and a queue that buries open work
 * under history stops being a queue.
 */
export async function fetchAgentRequests(): Promise<AgentRequestRow[]> {
  const { data, error } = await supabase
    .from('agent_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const rank: Record<RequestStatus, number> = {
    new: 0, in_progress: 1, delivered: 2, declined: 3,
  };
  return ((data ?? []) as AgentRequestRow[])
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

export async function updateAgentRequest(
  id: string,
  patch: Partial<Pick<AgentRequestRow, 'status' | 'output_url' | 'output_note'>>,
): Promise<void> {
  const { error } = await supabase.from('agent_requests').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteAgentRequest(id: string): Promise<void> {
  const { error } = await supabase.from('agent_requests').delete().eq('id', id);
  if (error) throw error;
}

/**
 * The brief, as a block of text to hand an agent.
 *
 * This is the whole point of the desk: the requester answers three plain questions and
 * this turns them into something that can be pasted straight into an agent invocation,
 * so nobody has to re-type a brief or paraphrase it into something subtly different.
 */
export function briefFor(r: AgentRequestRow): string {
  const line = (label: string, v: string | null) => (v ? `${label}: ${v}\n` : '');
  return (
    `Agent: ${r.agent}\n` +
    `Request: ${r.title}\n` +
    line('Audience', r.audience) +
    line('They should be able to', r.goal) +
    line('Shown on', r.channel) +
    `Language: ${r.language}\n` +
    `Deliver as: ${r.output_format === 'both' ? 'video AND slide deck' : r.output_format}\n` +
    line('Needed by', r.needed_by) +
    line('Notes', r.notes)
  );
}
