import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Whether a contractor lands on the board.
 *
 * This lookup fails by returning `null`, which moves nobody and looks exactly like "no
 * pipeline configured yet" — the same silent-failure shape that cost a day on the custom
 * fields. The stage ids are pasted by hand into `ghl_stage_map`, so the mapping between
 * our keys and Philip's stage ids is the most typo-prone surface in the integration.
 *
 * The real ids below are the Contractor onboarding pipeline, 3 Sep 2026.
 */

const PIPELINE = 'IXiiJwIomXDCdOxGreoC';

async function fresh(stageMap: Record<string, string> | null) {
  vi.resetModules();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; // force the env fallback, no DB read
  process.env.GHL_PIPELINE_ID = PIPELINE;
  if (stageMap) process.env.GHL_STAGE_MAP = JSON.stringify(stageMap);
  else delete process.env.GHL_STAGE_MAP;
  return import('../../../api/ghl/_pipeline');
}

beforeEach(() => { vi.resetModules(); });

describe('stageForKey', () => {
  it('places a new application on the mapped stage', async () => {
    const { stageForKey } = await fresh({ contractor_application: 'stage_applied' });
    expect(await stageForKey('contractor_application'))
      .toEqual({ pipelineId: PIPELINE, stageId: 'stage_applied' });
  });

  it('moves nobody when the key is not mapped', async () => {
    // The common, harmless case: a half-configured pipeline should leave the board alone
    // rather than pile everyone into whichever stage happened to be listed first.
    const { stageForKey } = await fresh({ 'application_decision:accepted': 'stage_ok' });
    expect(await stageForKey('contractor_application')).toBeNull();
  });

  it('moves nobody when no map is set at all', async () => {
    const { stageForKey } = await fresh(null);
    expect(await stageForKey('contractor_application')).toBeNull();
  });

  it('survives a malformed map instead of throwing into the sync', async () => {
    vi.resetModules();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.GHL_PIPELINE_ID = PIPELINE;
    process.env.GHL_STAGE_MAP = '{not json';
    const { stageForKey } = await import('../../../api/ghl/_pipeline');
    expect(await stageForKey('contractor_application')).toBeNull();
  });
});

describe('stageFor', () => {
  it('prefers the variant-specific key over the bare event', async () => {
    const { stageFor } = await fresh({
      application_decision: 'generic',
      'application_decision:accepted': 'accepted_stage',
    });
    expect((await stageFor('application_decision', 'accepted'))?.stageId).toBe('accepted_stage');
  });

  it('falls back to the bare event when the variant is not mapped', async () => {
    const { stageFor } = await fresh({ application_decision: 'generic' });
    expect((await stageFor('application_decision', 'rejected'))?.stageId).toBe('generic');
  });
});

describe('partyFor', () => {
  it('calls a contractor a contractor and everyone else a homeowner', async () => {
    const { partyFor } = await fresh(null);
    expect(partyFor('application_decision')).toBe('Contractor');
    expect(partyFor('user_signup')).toBe('Homeowner');
    expect(partyFor('project_created')).toBe('Homeowner');
    expect(partyFor('subscription_changed')).toBe('Homeowner');
  });
});
