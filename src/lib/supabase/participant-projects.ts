import { fetchClientProjects, type ClientProjects } from './projects';
import { fetchContractorProjects } from './invites';
import type { ProjectRow } from '@/types/project';

export interface ParticipantProjects extends ClientProjects {
  assigned: ProjectRow[];
}

/** A person's account role does not erase a different relationship on another build. */
export function mergeProjectRelationships(client: ClientProjects, assigned: ProjectRow[]): ParticipantProjects {
  const assignedIds = new Set(assigned.map(p => p.id));
  const shared = client.shared.filter(p => !assignedIds.has(p.id));
  const sharedIds = new Set(shared.map(p => p.id));
  const byId = new Map([...assigned, ...client.all].map(p => [p.id, p]));
  return {
    ...client, shared, assigned,
    all: [...byId.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    isShared: id => sharedIds.has(id),
  };
}

export async function fetchParticipantProjects(userId: string, includeAssignments: boolean): Promise<ParticipantProjects> {
  const [client, assigned] = await Promise.allSettled([
    fetchClientProjects(userId),
    includeAssignments ? fetchContractorProjects(userId) : Promise.resolve([] as ProjectRow[]),
  ]);
  const available = client.status === 'fulfilled' ? client.value
    : { owned: [], shared: [], all: [], isShared: () => false, loadFailed: true };
  return {
    ...mergeProjectRelationships(available, assigned.status === 'fulfilled' ? assigned.value : []),
    loadFailed: available.loadFailed || assigned.status === 'rejected',
  };
}
