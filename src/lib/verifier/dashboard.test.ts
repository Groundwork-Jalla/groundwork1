import { describe, expect, it } from 'vitest';
import type { VerifierWorkItem } from '@/lib/supabase/verifier-work';
import { matchesWorkFilter, searchWork, verifierSummary } from './dashboard';

const base: VerifierWorkItem = {
  id: 'verification-a', projectId: 'project-a', projectName: 'Bastos Residence', projectCity: 'Yaoundé', projectCountry: 'Cameroon',
  stageId: 'stage-a', stageNumber: 2, stageName: 'Foundations', stageKey: null, discipline: null,
  requestedAt: '2026-09-01T10:00:00Z', visitedAt: null, decision: 'pending', decidedAt: null, findings: null,
};
const now = new Date(2026, 8, 28, 12); // Monday: the weekly boundary must exclude Sunday.
const sunday = new Date(2026, 8, 27, 12).toISOString();
const monday = new Date(2026, 8, 28, 9).toISOString();

describe('verifier dashboard counts', () => {
  it('counts unfinished findings separately from completed requests for more evidence', () => {
    expect(verifierSummary([
      base,
      { ...base, visitedAt: monday },
      { ...base, decision: 'needs_more_evidence', visitedAt: sunday, decidedAt: monday },
      { ...base, decision: 'verified', visitedAt: sunday, decidedAt: sunday },
    ], now)).toEqual({ pending: 2, visited: 1, findings: 1, recorded: 1 });
  });
  it('uses the local calendar week and excludes future or missing decisions', () => {
    expect(matchesWorkFilter({ ...base, decision: 'rejected', decidedAt: sunday }, 'recorded', now)).toBe(false);
    expect(matchesWorkFilter({ ...base, decision: 'rejected', decidedAt: monday }, 'recorded', now)).toBe(true);
    expect(matchesWorkFilter({ ...base, decision: 'rejected', decidedAt: new Date(2026, 8, 29).toISOString() }, 'recorded', now)).toBe(false);
    expect(matchesWorkFilter({ ...base, decision: 'verified' }, 'recorded', now)).toBe(false);
  });
  it('searches names, locations and references without requiring accents', () => {
    expect(searchWork(base, 'yaounde foundations')).toBe(true);
    expect(searchWork(base, 'verification-a')).toBe(true);
    expect(searchWork(base, 'Douala')).toBe(false);
  });
});
