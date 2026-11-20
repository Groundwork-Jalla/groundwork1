import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';

/**
 * The redesigned Stage Reviews (18 Nov, reviews-desktop.png): the queue beside the stage
 * under review. Every button is pressed and must still reach the call it did before.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  stages: [] as any[], approve: vi.fn(), rework: vi.fn(), request: vi.fn(), record: vi.fn(),
  verifications: [] as any[], verifiers: [] as any[], updates: [] as any[],
}));
vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  const slot = () => { const list = h.store.get(h.path) ?? []; h.store.set(h.path, list); return { list, i: h.idx++ }; };
  return { ...real,
    useState: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = typeof initial === 'function' ? initial() : initial;
      return [list[i], (value: any) => { list[i] = typeof value === 'function' ? value(list[i]) : value; }]; },
    useRef: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = { current: initial }; return list[i]; },
    useEffect: (run: () => any) => { h.idx++; h.effects.push({ run }); },
    useMemo: (make: () => any) => { h.idx++; return make(); },
    useCallback: (callback: any) => { h.idx++; return callback; },
  };
});
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, AnimatePresence: ({ children }: any) => children }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'ruth' } }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/format', () => ({ formatRelative: (value: string) => `rel(${value})` }));
vi.mock('@/lib/supabase/client', () => {
  const chain: any = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: h.stages, error: null }) };
  return { supabase: { from: () => chain } };
});
vi.mock('@/lib/supabase/admin-users', () => ({
  ownerLookup: async () => new Map([['u1', { email: 'claire@x.cm', name: 'Claire Mbala' }], ['u2', { email: 'ama@x.cm', name: 'Ama Kouam' }]]),
  listAdminUsers: async () => [{ id: 'ver1', fullName: 'Vanessa G.', email: 'v@x.cm' }],
}));
vi.mock('@/lib/supabase/approvals', () => ({ adminApproveStage: h.approve, adminRequestRework: h.rework }));
vi.mock('@/lib/supabase/verifications', () => ({
  listProjectVerifications: async () => ({ rows: h.verifications, available: true }),
  latestForStage: (rows: any[], stageId: string) => rows.find(r => r.stageId === stageId) ?? null,
  requestVerification: h.request, recordVerification: h.record,
}));
vi.mock('@/lib/supabase/verifiers', () => ({ listProjectVerifiers: async () => ({ rows: h.verifiers, available: true }) }));
vi.mock('@/lib/supabase/site-updates', () => ({ listSiteUpdates: async () => ({ rows: h.updates, available: true }) }));
vi.mock('@/components/ui/ConfirmModal', () => ({ ConfirmModal: 'mock-confirm' }));
vi.mock('@/components/admin/stages/ReworkModal', () => ({ ReworkModal: 'mock-rework' }));
vi.mock('@/components/admin/stages/RecordVerificationModal', () => ({ RecordVerificationModal: 'mock-record' }));
import AdminReviews from '@/app/routes/admin/reviews';

type Node = { type: any; props: Record<string, any>; key?: string | null };
function expand(value: any, path: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((child, i) => expand(child, `${path}.${child?.key ?? i}`));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  if (typeof value.type === 'function') {
    const saved = [h.path, h.idx] as const; h.path = `${path}/${value.type.name}`; h.idx = 0;
    const out = value.type(value.props); const inner = h.path; [h.path, h.idx] = saved;
    return [value, ...expand(out, inner)];
  }
  return [value, ...expand(value.props?.children, path)];
}
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: AdminReviews, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const button = (view: Node[], label: string) => view.find(n => n.type === 'button' && text(n.props.children).includes(label));
const L = (key: string) => lookup(en as never, key) as string;

const stage = (id: string, n: number, name: string, project: string, owner: string, verification = false) => ({
  id, stage_number: n, name, completed_at: '2026-11-17T08:00:00Z', verification_required: verification,
  projects: { id: `proj-${id}`, name: project, user_id: owner, tier: 'jalla_verify' },
  project_substages: [{ id: `${id}-a`, name: 'Columns and ring beam', status: 'complete', evidence_urls: ['https://x/1.jpg'] }, { id: `${id}-b`, name: 'Curing', status: 'pending', evidence_urls: [] }],
});

beforeEach(() => {
  h.store = new Map();
  h.stages = [stage('s5', 5, 'Structure & walls', 'Mbala Residence', 'u1', true), stage('s3', 3, 'Site preparation', 'Kouam house', 'u2')];
  h.verifications = []; h.updates = [];
  h.verifiers = [{ id: 'pv1', userId: 'ver1', discipline: 'structural' }];
  for (const f of [h.approve, h.rework, h.request, h.record]) f.mockReset().mockResolvedValue(undefined);
});

describe('Stage Reviews, redesigned', () => {
  it('lists the queue and opens the first stage beside it', async () => {
    const view = await settle();
    const queue = view.filter(n => n.type === 'button' && n.props['aria-current'] !== undefined || (n.type === 'button' && text(n.props.children).includes('Kouam house')));
    expect(queue.length).toBeGreaterThanOrEqual(2);
    expect(view.find(n => n.type === 'h3')?.props.children).toBe('Structure & walls');
  });

  it('picking a stage in the queue shows that stage', async () => {
    let view = await settle();
    button(view, 'Kouam house')!.props.onClick();
    view = render();
    expect(view.find(n => n.type === 'h3')?.props.children).toBe('Site preparation');
    expect(button(view, 'Kouam house')!.props['aria-current']).toBe('true');
  });

  it('the project opens the homeowner view in a new tab; Open workspace lands on the stage', async () => {
    const view = await settle();
    const links = view.filter(n => n.type === 'a');
    expect(links.find(l => l.props.to === '/projects/proj-s5')?.props.target).toBe('_blank');
    expect(links.map(l => l.props.to)).toContain('/admin/projects/proj-s5?tab=stages&stage=s5');
  });

  it('a verification-gated stage cannot be approved until verified; request verification calls the API', async () => {
    let view = await settle();
    expect(button(view, L('admin.reviewsQueue.approve'))!.props.disabled).toBe(true);
    view.find(n => n.type === 'select')!.props.onChange({ target: { value: 'ver1' } });
    view = render();
    await button(view, L('admin.verification.request'))!.props.onClick();
    expect(h.request).toHaveBeenCalledWith('s5', 'ver1');
  });

  it('approve asks first, then approves that stage and moves to the next', async () => {
    let view = await settle();
    button(view, 'Kouam house')!.props.onClick(); view = render();
    const approve = button(view, L('admin.reviewsQueue.approve'))!;
    expect(approve.props.disabled).toBe(false);
    approve.props.onClick(); view = render();
    const confirm = view.find(n => n.type === 'mock-confirm')!;
    expect(confirm.props.open).toBe(true);
    await confirm.props.onConfirm(); await flush();
    expect(h.approve).toHaveBeenCalledWith('proj-s3', 's3', 3, 'ruth');
    view = render();
    expect(view.find(n => n.type === 'h3')?.props.children).toBe('Structure & walls');
  });

  it('request changes opens the rework dialog and sends the reason', async () => {
    let view = await settle();
    button(view, L('admin.requestChanges'))!.props.onClick(); view = render();
    const rework = view.find(n => n.type === 'mock-rework')!;
    expect(rework.props.open).toBe(true);
    await rework.props.onConfirm('Lintel not level'); await flush();
    expect(h.rework).toHaveBeenCalledWith('proj-s5', 's5', 5, 'ruth', 'Lintel not level');
  });

  it('a pending verification offers Record the verifier\'s decision', async () => {
    h.verifications = [{ id: 'v1', stageId: 's5', verifierId: 'ver1', decision: 'pending', visitedAt: null }];
    let view = await settle();
    button(view, L('admin.verification.recordDecision'))!.props.onClick(); view = render();
    expect(view.find(n => n.type === 'mock-record')?.props.open).toBe(true);
  });

  it('every evidence file still opens', async () => {
    const view = await settle();
    // Evidence now opens inside the in-app EvidenceLightbox via EvidenceThumbs rather
    // than navigating to a raw relative storage path.
    const thumbs = view.find(n => n.type?.name === 'EvidenceThumbs');
    expect(thumbs?.props.paths).toEqual(['https://x/1.jpg']);
    expect(view.filter(n => n.type === 'button' && n.props.title === '1.jpg')).toHaveLength(1);
  });

  it('the new strings are translated', () => {
    for (const k of ['subtitle', 'waiting', 'inReview', 'stage', 'substages', 'approve']) {
      expect(lookup(fr as never, `admin.reviewsQueue.${k}`), k).not.toBe(lookup(en as never, `admin.reviewsQueue.${k}`));
    }
  });
});
