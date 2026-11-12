import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: h.rpc } }));
import { stagePricePreview, proposeStagePrices, decideStagePrices, fetchStagePriceContext, type StagePriceContext } from './stage-pricing';
import { accountType, setAccountType } from './admin-users';
const context: StagePriceContext = { project_id: 'project', currency: 'XAF', fx_rate: '600', total: '141407337.524', base_hash: 'snapshot', can_propose: true, can_approve: false, history: [],
  stages: [{ id: 'stage', stage_number: 3, stage_key: null, name: 'Foundation', amount: '60000.125', editable: true },
    { id: 'zero', stage_number: 1, stage_key: null, name: 'Land', amount: '0', editable: false }] };
beforeEach(() => { vi.clearAllMocks(); h.rpc.mockResolvedValue({ data: null, error: null }); });
describe('client-approved stage price requests', () => {
  it('previews native price increases and decreases without changing the current total', () => {
    expect(stagePricePreview(context, { stage: '72000.125' })).toEqual({ rows: [{ stage_id: 'stage', amount: '72000.125' }], total: '141419337.524000' });
    expect(stagePricePreview(context, { stage: '48000.125' })?.total).toBe('141395337.524000');
    expect(context.total).toBe('141407337.524');
  });
  it('retains six-decimal changes at large source amounts', () => {
    const huge = { ...context, total: '987654321098.123456' };
    expect(stagePricePreview(huge, { stage: '60000.125001' })?.total).toBe('987654321098.123457');
  });
  it('keeps fixed stages unchanged and treats equivalent decimal notation as unchanged', () => {
    expect(stagePricePreview(context, { zero: '1', stage: '60000.125000' })?.rows).toEqual([]);
  });
  it.each(['0', '-1', 'NaN', '', '1.1234567', '1000000000001'])('refuses unsupported stage price %s', amount => {
    expect(stagePricePreview(context, { stage: amount })).toBeNull();
  });
  it('sends the exact rows and original snapshot for server validation', async () => {
    const rows = [{ stage_id: 'stage', amount: '72000.125' }];
    await proposeStagePrices('project', rows, 'snapshot', ' Materials ');
    expect(h.rpc).toHaveBeenCalledWith('propose_stage_prices', { p_project: 'project', p_rows: rows, p_base_hash: 'snapshot', p_note: 'Materials' });
    await decideStagePrices('proposal', 'approved');
    expect(h.rpc).toHaveBeenLastCalledWith('decide_stage_prices', { p_proposal: 'proposal', p_decision: 'approved' });
  });
  it('propagates server refusals instead of displaying an approved price', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'stale_stage_prices' } });
    await expect(decideStagePrices('proposal', 'approved')).rejects.toMatchObject({ message: 'stale_stage_prices' });
  });
  it('rejects a context belonging to a different project', async () => {
    h.rpc.mockResolvedValue({ data: context });
    await expect(fetchStagePriceContext('other')).rejects.toThrow('stage_prices_unavailable');
  });
});
describe('administrator account-type correction', () => {
  it('reads the base type independently of staff and verifier roles', () => {
    expect(accountType('admin, contractor, verifier')).toBe('contractor');
    expect(accountType('admin,verifier')).toBe('client');
    expect(accountType('homeowner')).toBe('client');
  });
  it('carries the expected old type and returns the canonical role list', async () => {
    h.rpc.mockResolvedValue({ data: { account_type: 'contractor', roles: 'contractor,verifier' } });
    expect(await setAccountType('user', 'contractor', 'client')).toBe('contractor,verifier');
    expect(h.rpc).toHaveBeenCalledWith('admin_set_account_type', { p_user: 'user', p_type: 'contractor', p_expected_type: 'client' });
  });
  it('keeps the assignment guard visible to the admin editor', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'contractor_assignments_exist' } });
    await expect(setAccountType('user', 'client', 'contractor')).rejects.toMatchObject({ message: 'contractor_assignments_exist' });
  });
});
