import { fetchProject, fetchProjectStages, fetchProjectSubstages, fetchProjectFees } from './projects';
import { ownerLookup } from './admin-users';
import { listSiteUpdates } from './site-updates';
import { listProjectVerifications } from './verifications';
import { listProjectVerifiers } from './verifiers';
import { listProjectPayments } from './payments';
import { listConversations, listDecisions } from './conversations';
import { fetchDocuments } from './documents';
import { fetchInvites } from './invites';
import { listProjectActivity } from './activity';
import { assembleWorkspace, type Soft, type Workspace, type WorkspaceDomain } from '@/lib/admin/workspace';

// =========================================================
// loadWorkspace(projectId) — every read the Project Workspace needs, in one call
// (05 §13). One `Promise.all` for what the page cannot exist without (the project, its
// stages, substages, fees, and the people lookup), then one `Promise.allSettled` for the
// nine domains that may each be missing on their own.
//
// FAIL-SOFT PER DOMAIN, NEVER PER PAGE. A migration pasted by hand can lag a deploy by a
// day; when it does, that domain's tab shows "not available yet" and every other tab is
// exactly as good as it would have been. This is the 086–091 rule and the loader keeps
// it — and it also keeps the distinction those modules draw: `available: false` means
// "the table is not there", `errors[domain]` means "it is there and the read failed",
// and the UI must not describe the second as the first.
//
// NOTHING IS WRITTEN. The workspace is read-only at the loader; every action a tab
// offers is an existing SECURITY DEFINER RPC that re-checks the actor (03 §6).
// =========================================================

export interface LoadedWorkspace {
  workspace: Workspace;
  /** A domain whose read threw (not "not applied" — that is `workspace.available`). */
  errors: Partial<Record<WorkspaceDomain, string>>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'read failed');

/** A settled fail-soft read: the module's own `{rows, available}`, or unavailable + the reason. */
function soft<T>(r: PromiseSettledResult<{ rows: T[]; available: boolean }>): { value: Soft<T>; error?: string } {
  return r.status === 'fulfilled' ? { value: r.value } : { value: { rows: [], available: false }, error: message(r.reason) };
}
/** A settled plain-array read (older modules return `T[]` and throw), lifted to the same shape. */
function plain<T>(r: PromiseSettledResult<T[]>): { value: Soft<T>; error?: string } {
  return r.status === 'fulfilled' ? { value: { rows: r.value, available: true } } : { value: { rows: [], available: false }, error: message(r.reason) };
}

/** Null when there is no such project (or the caller may not see it — RLS answers the same). */
export async function loadWorkspace(projectId: string, now: Date = new Date()): Promise<LoadedWorkspace | null> {
  const project = await fetchProject(projectId);
  if (!project) return null;

  const [stages, substages, fees, people] = await Promise.all([
    fetchProjectStages(projectId),
    fetchProjectSubstages(projectId),
    fetchProjectFees(projectId),
    ownerLookup(),
  ]);

  const [su, ver, vf, pay, conv, dec, docs, inv, act] = await Promise.allSettled([
    listSiteUpdates(projectId),
    listProjectVerifications(projectId),
    listProjectVerifiers(projectId),
    listProjectPayments(projectId),
    listConversations({ projectId }),
    listDecisions(projectId),
    fetchDocuments(projectId),
    fetchInvites(projectId),
    listProjectActivity(projectId),
  ]);

  const d = {
    siteUpdates:   soft(su),
    verifications: soft(ver),
    verifiers:     soft(vf),
    ledger:        soft(pay),
    conversations: soft(conv),
    decisions:     soft(dec),
    documents:     plain(docs),
    invites:       plain(inv),
    activity:      plain(act),
  };

  const errors: LoadedWorkspace['errors'] = {};
  for (const [k, v] of Object.entries(d)) if (v.error) errors[k as WorkspaceDomain] = v.error;

  const workspace = assembleWorkspace({
    project, stages, substages, fees, people,
    siteUpdates:   d.siteUpdates.value,
    verifications: d.verifications.value,
    verifiers:     d.verifiers.value,
    payments:      d.ledger.value,
    conversations: d.conversations.value,
    decisions:     d.decisions.value,
    documents:     d.documents.value,
    invites:       d.invites.value,
    activity:      d.activity.value,
  }, now);

  return { workspace, errors };
}
