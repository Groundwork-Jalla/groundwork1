import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '@/types/project';
import type { StagePriceContext } from '@/lib/supabase/stage-pricing';
const h = vi.hoisted(() => ({ index: 0, hooks: [] as any[], effects: [] as (() => unknown)[], fetch: vi.fn(), propose: vi.fn(), decide: vi.fn(), changed: vi.fn(), setType: vi.fn(), savedType: vi.fn(), close: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const at = h.index++; if (!(at in h.hooks)) h.hooks[at] = initial; return [h.hooks[at], (value: any) => { h.hooks[at] = typeof value === 'function' ? value(h.hooks[at]) : value; }]; },
  useRef: (initial: any) => { const at = h.index++; return h.hooks[at] ?? (h.hooks[at] = { current: initial }); },
  useEffect: (effect: () => unknown) => { h.effects.push(effect); }, useCallback: (fn: any) => fn,
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values?: any) => key + (values ? JSON.stringify(values) : ''), useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (stage: any) => stage.name }) }));
vi.mock('@/lib/supabase/stage-pricing', async original => ({ ...await original<typeof import('@/lib/supabase/stage-pricing')>(), fetchStagePriceContext: h.fetch, proposeStagePrices: h.propose, decideStagePrices: h.decide }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn() } }));
vi.mock('@/lib/supabase/admin-users', () => ({ accountType: (roles: string) => roles.split(',').some(role => role.trim()==='contractor') ? 'contractor' : 'client', setAccountType: h.setType }));
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StagePricingPanel } from '@/components/project/StagePricingPanel';
import { AccountTypeEditor } from '@/components/admin/AccountTypeEditor';
import type { AdminUser } from '@/lib/supabase/admin-users';
type Element = { type: unknown; props: any };
function nodes(value: any): Element[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''; }
const project = { id: 'project', budget_source: 'boq', budget_amount: 180000, budget_currency: 'XAF' } as ProjectRow;
const context: StagePriceContext = { project_id: 'project', currency: 'XAF', fx_rate: '600', total: '180000', base_hash: 'version', can_propose: true, can_approve: false,
  stages: [{ id: 'stage', stage_number: 3, name: 'Foundation', stage_key: null, amount: '60000', editable: true }, { id: 'land', stage_number: 1, name: 'Land', stage_key: null, amount: '0', editable: false }], history: [] };
const proposal = { id: 'proposal', status: 'pending' as const, proposed_at: '', currency: 'XAF', old_total: '180000', new_total: '192000', changes: [{ stage_id: 'stage', stage_number: 3, name: 'Foundation', stage_key: null, before: '60000', after: '72000' }], note: 'Materials', can_withdraw: false, stale: false };
function render(source = project) { h.index = 0; h.effects = []; return nodes(StagePricingPanel({ project: source, onChanged: h.changed })); }
async function load(model = context) { h.fetch.mockResolvedValue(structuredClone(model)); render(); h.effects[0](); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); h.index = 0; h.hooks = []; h.effects = []; h.propose.mockResolvedValue('proposal'); h.decide.mockResolvedValue(undefined); h.changed.mockResolvedValue(undefined); vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
describe('stage price proposals and client decisions', () => {
  it('lets the primary contractor prepare a new total while fixed stages remain without inputs', async () => {
    await load(); render().find(e => e.type === 'button' && text(e) === 'project.priceChanges.propose')!.props.onClick();
    expect(render().some(e => e.props.name === 'stage-price-land')).toBe(false);
    render().find(e => e.props.name === 'stage-price-stage')!.props.onChange({ target: { value: '72000' } });
    expect(text(render())).toContain('192,000 XAF');
    render().find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} });
    await Promise.resolve(); await Promise.resolve();
    expect(h.propose).not.toHaveBeenCalled();render().find(e=>e.type===ConfirmModal&&e.props.open)!.props.onConfirm();await Promise.resolve();await Promise.resolve();
    expect(h.propose).toHaveBeenCalledWith('project', [{ stage_id: 'stage', amount: '72000' }], 'version', '');
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('lets the client approve the same pending proposal without offering a price editor', async () => {
    await load({ ...context, can_propose: false, can_approve: true, history: [proposal] });
    expect(render().some(e => e.type === 'input' || text(e) === 'project.priceChanges.propose')).toBe(false);
    render().find(e => e.type === 'button' && text(e) === 'project.priceChanges.approve')!.props.onClick();
    await Promise.resolve(); await Promise.resolve();
    expect(h.decide).not.toHaveBeenCalled();render().find(e=>e.type===ConfirmModal&&e.props.open)!.props.onConfirm();await Promise.resolve();await Promise.resolve();expect(h.decide).toHaveBeenCalledWith('proposal', 'approved'); expect(h.propose).not.toHaveBeenCalled();
  });
  it('disables stale approval while allowing the client to retain current prices', async () => {
    await load({ ...context, can_propose: false, can_approve: true, history: [{ ...proposal, stale: true }] });
    expect(render().find(e => e.type === 'button' && text(e) === 'project.priceChanges.approve')?.props.disabled).toBe(true);
    render().find(e => e.type === 'button' && text(e) === 'project.priceChanges.decline')!.props.onClick();
    await Promise.resolve();expect(h.decide).not.toHaveBeenCalled();render().find(e=>e.type===ConfirmModal&&e.props.open)!.props.onConfirm();await Promise.resolve();expect(h.decide).toHaveBeenCalledWith('proposal', 'declined');
  });
  it('shows observers proposal history with no mutation controls', async () => {
    await load({ ...context, can_propose: false, can_approve: false, history: [proposal] });
    expect(text(render())).toContain('192,000 XAF');
    expect(render().some(e => e.type === 'button' || e.type === 'form')).toBe(false);
  });
  it('does not display a previous project’s budget when the route changes', async () => {
    await load({ ...context, history: [proposal] }); expect(text(render())).toContain('192,000 XAF');
    expect(text(render({ ...project, id: 'other' }))).not.toContain('192,000 XAF');
  });
});

function accountEditor() { h.index=0; return nodes(AccountTypeEditor({ user: { id: 'user', email: 'person@test.example', roles: 'verifier' } as AdminUser, onSaved: h.savedType, onClose: h.close })); }
describe('the admin account-type editor', () => {
  it('offers client and contractor types while preserving special roles on the server', async () => {
    expect(accountEditor().filter(node => node.type==='option').map(node => node.props.value)).toEqual(['client','contractor']);
    h.setType.mockResolvedValue('contractor,verifier');
    accountEditor().find(node => node.type==='select')!.props.onChange({target:{value:'contractor'}});
    accountEditor().find(node => node.type==='form')!.props.onSubmit({preventDefault(){}});
    await Promise.resolve();await Promise.resolve();
    expect(h.setType).toHaveBeenCalledWith('user','contractor','client');expect(h.savedType).toHaveBeenCalledWith('contractor,verifier');
  });
  it('shows an assignment refusal instead of claiming a contractor became a client', async () => {
    h.setType.mockRejectedValue({message:'contractor_assignments_exist'});
    accountEditor().find(node => node.type==='select')!.props.onChange({target:{value:'contractor'}});
    accountEditor().find(node => node.type==='form')!.props.onSubmit({preventDefault(){}});
    await Promise.resolve();await Promise.resolve();
    expect(text(accountEditor())).toContain('admin.accountTypeEdit.assignments');expect(h.savedType).not.toHaveBeenCalled();
  });
});
