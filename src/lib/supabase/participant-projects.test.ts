import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '@/types/project';

const reads = vi.hoisted(() => ({ client: vi.fn(), contractor: vi.fn() }));
vi.mock('./projects', () => ({ fetchClientProjects: reads.client }));
vi.mock('./invites', () => ({ fetchContractorProjects: reads.contractor }));
import { fetchParticipantProjects, mergeProjectRelationships } from './participant-projects';

const row = (id: string, day = 1) => ({ id, created_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z` }) as ProjectRow;
function client(owned: ProjectRow[] = [], shared: ProjectRow[] = []) {
  return { owned, shared, all: [...owned, ...shared], isShared: (id: string) => shared.some(p => p.id === id) };
}
beforeEach(() => {
  reads.client.mockReset().mockResolvedValue(client());
  reads.contractor.mockReset().mockResolvedValue([]);
});

describe('projects follow each membership rather than the global account role', () => {
  it('keeps owned and client-shared projects alongside contractor assignments', async () => {
    reads.client.mockResolvedValue(client([row('owned', 1)], [row('client', 2)]));
    reads.contractor.mockResolvedValue([row('assigned', 3)]);
    const result = await fetchParticipantProjects('person', true);
    expect(result.all.map(p => p.id)).toEqual(['assigned', 'client', 'owned']);
    expect(result.owned.map(p => p.id)).toEqual(['owned']);
    expect(result.isShared('client')).toBe(true);
    expect(result.isShared('assigned')).toBe(false);
  });

  it('deduplicates a build with several relationships and retains contractor access', () => {
    const result = mergeProjectRelationships(client([row('owned')], [row('both')]), [row('owned'), row('both')]);
    expect(result.all).toHaveLength(2);
    expect(result.owned).toHaveLength(1);
    expect(result.shared).toHaveLength(0);
    expect(result.assigned).toHaveLength(2);
    expect(result.isShared('both')).toBe(false);
  });

  it('does not query assignments for a client-only account', async () => {
    await fetchParticipantProjects('person', false);
    expect(reads.contractor).not.toHaveBeenCalled();
  });

  it('retains available projects and reports a failed relationship lookup', async () => {
    reads.client.mockResolvedValue({ ...client([row('owned')]), loadFailed: true });
    reads.contractor.mockRejectedValue(new Error('offline'));
    const result = await fetchParticipantProjects('person', true);
    expect(result.all.map(p => p.id)).toEqual(['owned']);
    expect(result.loadFailed).toBe(true);
  });

  it('retains contractor assignments when the client query fails', async () => {
    reads.client.mockRejectedValue(new Error('offline'));
    reads.contractor.mockResolvedValue([row('assigned')]);
    const result = await fetchParticipantProjects('person', true);
    expect(result.all.map(p => p.id)).toEqual(['assigned']);
    expect(result.loadFailed).toBe(true);
  });
});
