import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import type { ProjectCloseout } from '@/lib/supabase/project-closeout';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, ei: 0,
  fetch: vi.fn(), close: vi.fn(), closed: vi.fn(), view: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((v, k) => !Object.is(v, h.deps[i][k]))) {
    h.deps[i] = deps; h.effects.push({ index: i, effect }); } },
}));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }), useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key) as string;
  return source.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
} }));
vi.mock('@/lib/supabase/project-closeout', () => ({ fetchProjectCloseout: h.fetch, closeProject: h.close,
  closeoutNotInstalled: (error: { code?: string } | null) => ['PGRST202', '42883'].includes(error?.code ?? '') }));
import { ProjectCloseoutPanel } from './ProjectCloseoutPanel';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
const props = { projectId: 'project', refreshKey: 1 as unknown, onClosed: h.closed, onViewStage: h.view, stageName: (_id: string, n: number) => `Stage ${n} name` };
function render(overrides: Partial<typeof props> = {}) {
  h.si = h.ri = h.ei = 0;
  const tree = ProjectCloseoutPanel({ ...props, ...overrides });
  for (const { index, effect } of h.effects.splice(0)) { h.cleanups[index]?.(); h.cleanups[index] = effect(); }
  return nodes(tree);
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function load(context: ProjectCloseout | Error, overrides: Partial<typeof props> = {}) {
  if (context instanceof Error) h.fetch.mockRejectedValue(context); else h.fetch.mockResolvedValue(structuredClone(context));
  render(overrides); await flush(); return render(overrides);
}
const button = (view: Node[], label: string) => view.find(node => node.type === 'button' && text(node) === label);
const settled: ProjectCloseout = { project_id: 'project', status: 'active', closed: false, all_stages_complete: true, currency: 'XAF',
  outstanding: '0', pending_receipts: 0, stages: [], can_close: true };
const owed: ProjectCloseout = { ...settled, outstanding: '48000.000000', can_close: false, stages: [{ stage_id: 'stage-4', stage_number: 4, remaining: '48000.000000' }] };

beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.effects = []; h.closed.mockResolvedValue(undefined); });
afterEach(() => { h.cleanups.forEach(cleanup => cleanup?.()); });

describe('closing out a project', () => {
  it.each([
    ['stages are still in progress', { ...settled, all_stages_complete: false, can_close: false }],
    ['the project is already closed', { ...settled, status: 'completed', closed: true, can_close: false }],
    ['the project is on hold', { ...settled, status: 'on_hold', can_close: false }],
  ])('stays out of the way while %s', async (_label, context) => {
    expect(await load(context as ProjectCloseout)).toEqual([]);
  });

  it('stays away when the close-out cannot be read, never claiming nothing is owed', async () => {
    expect(await load(new Error('network'))).toEqual([]);
    expect(await load(Object.assign(new Error('missing'), { code: 'PGRST202' }))).toEqual([]);
  });

  it('names the stage and the amount still owed, and offers no way to close', async () => {
    const view = await load(owed);
    expect(text(view)).toContain('The project stays open until the amounts below are paid and confirmed.');
    expect(text(view)).toContain('Still to pay: 48,000 XAF');
    expect(text(view)).toContain('Stage 4 name');
    expect(button(view, 'Close project')).toBeUndefined();
    button(view, 'Open stage')!.props.onClick();
    expect(h.view).toHaveBeenCalledWith('stage-4');
  });

  it('holds the project open for a receipt the contractor has not decided', async () => {
    const view = await load({ ...settled, pending_receipts: 2, can_close: false });
    expect(text(view)).toContain('A payment receipt is still waiting for the contractor');
    expect(text(view)).toContain('Receipts waiting for the contractor: 2');
    expect(button(view, 'Close project')).toBeUndefined();
  });

  it('tells somebody who cannot close it who can', async () => {
    const view = await load({ ...settled, can_close: false });
    expect(button(view, 'Close project')).toBeUndefined();
    expect(text(view)).toContain('The client, the primary contractor or Jalla can close this project.');
  });

  it('closes a settled project only after an explicit confirmation', async () => {
    h.close.mockResolvedValue({ ...settled, status: 'completed', closed: true, can_close: false });
    button(await load(settled), 'Close project')!.props.onClick();
    expect(h.close).not.toHaveBeenCalled();
    const modal = render().find(node => node.type === ConfirmModal && node.props.open)!;
    expect(modal.props.description).toContain('no further work, receipts or payment decisions can be added');
    modal.props.onConfirm(); await flush();
    expect(h.close).toHaveBeenCalledWith('project');
    expect(h.closed).toHaveBeenCalledTimes(1);
    expect(render()).toEqual([]);
  });

  it('shows the refreshed figures when the database refuses because money arrived owed in the meantime', async () => {
    h.close.mockRejectedValue(new Error('closeout_balance_outstanding: 48000 XAF is still owed'));
    button(await load(settled), 'Close project')!.props.onClick();
    h.fetch.mockResolvedValue(structuredClone(owed));
    render().find(node => node.type === ConfirmModal && node.props.open)!.props.onConfirm(); await flush();
    const view = render();
    expect(text(view)).toContain('A balance is still outstanding, so the project was not closed.');
    expect(text(view)).toContain('Still to pay: 48,000 XAF');
    expect(h.closed).not.toHaveBeenCalled();
  });

  it('re-reads the figures whenever payments change', async () => {
    await load(owed);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    render({ refreshKey: 2 }); await flush();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('the close-out gate reaches every screen that depends on it', () => {
  const client = readFileSync('src/app/routes/projects/detail.tsx', 'utf8');
  const contractor = readFileSync('src/app/routes/work/projects.detail.tsx', 'utf8');
  it('is mounted for both the client and the contractor', () => {
    expect(client).toContain('<ProjectCloseoutPanel');
    expect(contractor).toContain('<ProjectCloseoutPanel');
  });
  it('no longer assumes the final approval completes the project', () => {
    // The database may keep the project open for an unpaid balance; the page must read it.
    expect(client).not.toMatch(/result\.isFinal[^\n]*'completed'/);
  });
  it('has every string in French as well', () => {
    for (const key of Object.keys((en as any).project.closeout)) expect(typeof (fr as any).project.closeout[key], key).toBe('string');
    for (const key of ['carriedIn', 'carriedOut', 'unusedCredit', 'acceptCredit', 'confirmCredit']) expect(typeof (fr as any).project.paymentPlan[key], key).toBe('string');
  });
});
