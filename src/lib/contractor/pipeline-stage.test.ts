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

/**
 * Contractors and homeowners are not one funnel.
 *
 * A contractor moves Applied → Interviewed → Accepted. A homeowner moves Signed up →
 * Building → Subscribed. Forcing both onto one board makes every column meaningless for
 * half the people standing in it, and GoHighLevel has no notion of a stage belonging to
 * two pipelines — so a stage value may name its own.
 */
describe('stageForKey across pipelines', () => {
  const CONTRACTORS = 'IXiiJwIomXDCdOxGreoC';
  const HOMEOWNERS  = 'HoMeOwNeRpIpEiD';

  it('uses the default pipeline for a bare stage id', async () => {
    const { stageForKey } = await fresh({ contractor_application: 'stage_applied' });
    expect(await stageForKey('contractor_application'))
      .toEqual({ pipelineId: CONTRACTORS, stageId: 'stage_applied' });
  });

  it('sends a homeowner to their own board when the value names it', async () => {
    const { stageForKey } = await fresh({
      contractor_application: 'stage_applied',
      user_signup: `${HOMEOWNERS}/stage_signed_up`,
    });
    expect(await stageForKey('user_signup'))
      .toEqual({ pipelineId: HOMEOWNERS, stageId: 'stage_signed_up' });
  });

  it('keeps the two funnels apart in one map', async () => {
    const { stageForKey } = await fresh({
      contractor_application: 'stage_applied',
      project_created: `${HOMEOWNERS}/stage_building`,
    });
    const contractor = await stageForKey('contractor_application');
    const homeowner  = await stageForKey('project_created');
    expect(contractor?.pipelineId).toBe(CONTRACTORS);
    expect(homeowner?.pipelineId).toBe(HOMEOWNERS);
    expect(contractor?.pipelineId).not.toBe(homeowner?.pipelineId);
  });

  it('a UUID stage id is not mistaken for a pipeline path', async () => {
    // Real stage ids contain hyphens but never a slash — the separator was chosen so
    // that every id already in ghl_stage_map keeps working untouched.
    const { stageForKey } = await fresh({
      contractor_application: '5e5a7691-8cd1-41e2-8b6f-301ecd1a90de',
    });
    expect(await stageForKey('contractor_application'))
      .toEqual({ pipelineId: CONTRACTORS, stageId: '5e5a7691-8cd1-41e2-8b6f-301ecd1a90de' });
  });
});

/**
 * The plan is a tag, not a pipeline.
 *
 * All three tiers walk the same journey — sign up, estimate, build stage by stage — and
 * what differs is who verifies each stage: the owner, Jalla on review, or Jalla
 * throughout. Three boards would show the same columns three times and force a manual
 * move on upgrade, which is the most valuable event in the funnel and the one whose
 * history you least want to lose.
 */
describe('tierTag', () => {
  it('names each plan', async () => {
    const { tierTag } = await fresh(null);
    expect(tierTag('self_verify')).toBe('groundwork:self-verify');
    expect(tierTag('jalla_verify')).toBe('groundwork:jalla-verify');
    expect(tierTag('jalla_management')).toBe('groundwork:jalla-managed');
  });

  it('tags nobody when the tier is unknown', async () => {
    // Absent must not read as free: an untagged contact is one we have not classified,
    // and tagging them self-verify would be a claim we cannot support.
    const { tierTag } = await fresh(null);
    expect(tierTag(null)).toBeNull();
    expect(tierTag('')).toBeNull();
    expect(tierTag('enterprise')).toBeNull();
  });

  it('rides alongside the identity tags rather than replacing them', async () => {
    const { tagsFor } = await fresh(null);
    const tags = tagsFor('project_created', undefined, 'fr', 'jalla_verify');
    expect(tags).toContain('groundwork');
    expect(tags).toContain('groundwork:homeowner');
    expect(tags).toContain('groundwork:building');
    expect(tags).toContain('groundwork:fr');
    expect(tags).toContain('groundwork:jalla-verify');
  });
});
