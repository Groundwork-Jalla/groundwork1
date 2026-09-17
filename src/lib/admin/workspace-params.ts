import type { Workspace, StageView, WorkspaceDomain } from './workspace';

// =========================================================
// The workspace's URL, and what it means (05 §5).
//
//   /admin/projects/:id?tab=<tab>[&stage=<stageId>][&conversation=<id>]
//
// Tab and selection live in the URL, not in component state, so every queue row and
// Action Center item can open the right tab on the right stage, and a reload or a shared
// link lands where the sender was. No nested routes: one route, three search params.
//
// Pure, so `workspace-params.test.ts` can pin the defaults and the fallbacks without a
// router: an unknown tab is `overview`, a stage id that is not on this project falls back
// to the current stage, and the Overview's "See all" activity link is the activity tab.
// =========================================================

export const WORKSPACE_TABS = [
  'overview', 'stages', 'financials', 'site-updates', 'documents', 'conversations', 'activity', 'team',
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** The tabs built so far (4: overview; 5a: activity, site-updates, documents; 5b.1: financials;
 *  5b.2: stages). The others exist as navigation targets with an honest "not built yet". */
export const BUILT_TABS: readonly WorkspaceTab[] = ['overview', 'activity', 'site-updates', 'documents', 'financials', 'stages'];

export interface WorkspaceParams {
  tab: WorkspaceTab;
  stageId: string | null;
  conversationId: string | null;
}

export function parseWorkspaceParams(params: URLSearchParams): WorkspaceParams {
  const raw = params.get('tab');
  return {
    tab: WORKSPACE_TABS.includes(raw as WorkspaceTab) ? (raw as WorkspaceTab) : 'overview',
    stageId: params.get('stage') || null,
    conversationId: params.get('conversation') || null,
  };
}

/** A link into the workspace. Omits `tab=overview` so the default URL stays short. */
export function workspaceHref(projectId: string, opts: { tab?: WorkspaceTab; stageId?: string | null; conversationId?: string | null } = {}): string {
  const p = new URLSearchParams();
  if (opts.tab && opts.tab !== 'overview') p.set('tab', opts.tab);
  if (opts.stageId) p.set('stage', opts.stageId);
  if (opts.conversationId) p.set('conversation', opts.conversationId);
  const q = p.toString();
  return `/admin/projects/${projectId}${q ? `?${q}` : ''}`;
}

/**
 * The stage the workspace is looking at: the one named in the URL when it belongs to this
 * project, else the project's current stage, else the first stage. Never a stage from
 * another project — a stale link must not show one project's stage under another's name.
 */
export function selectedStage(ws: Pick<Workspace, 'stages' | 'currentStage'>, stageId: string | null): StageView | null {
  if (stageId) {
    const hit = ws.stages.find(s => s.stage.id === stageId);
    if (hit) return hit;
  }
  return ws.currentStage ?? ws.stages[0] ?? null;
}

/**
 * The three things a tab must tell apart before it shows a number (Favour, 17 Sep 2026):
 * the migration is not applied · the read failed · the read worked and found nothing.
 * A zero that means "we could not look" is a lie, so the state is explicit.
 */
export type DomainState = 'unavailable' | 'error' | 'empty' | 'ready';

export function domainState(
  available: boolean,
  error: string | undefined,
  count: number,
): DomainState {
  if (error) return 'error';
  if (!available) return 'unavailable';
  return count === 0 ? 'empty' : 'ready';
}

export function domainStateOf(
  ws: Pick<Workspace, 'available'>,
  errors: Partial<Record<WorkspaceDomain, string>>,
  domain: WorkspaceDomain,
  count: number,
): DomainState {
  return domainState(ws.available[domain], errors[domain], count);
}

/**
 * A display name for any account the workspace has already resolved — owner, contractor,
 * verifier, or anyone who appears in the activity log. Profile name, then the address they
 * sign in with, then nothing: never a guess and never a raw id.
 */
export function nameLookup(ws: Pick<Workspace, 'team' | 'activity'>): (id: string | null | undefined) => string {
  const m = new Map<string, string>();
  if (ws.team.owner) m.set(ws.team.owner.id, ws.team.owner.name || ws.team.owner.email);
  for (const c of ws.team.contractors) if (c.contractor_user_id) m.set(c.contractor_user_id, c.name || c.email);
  for (const v of ws.team.verifiers) m.set(v.userId, v.name || v.email);
  for (const a of ws.activity) {
    if (a.actorId && a.actorName && !m.has(a.actorId)) m.set(a.actorId, a.actorName);
    if (a.personId && a.personName && !m.has(a.personId)) m.set(a.personId, a.personName);
  }
  return id => (id ? (m.get(id) ?? '') : '');
}
