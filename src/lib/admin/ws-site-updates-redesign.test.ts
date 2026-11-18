import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { assembleWorkspace } from './workspace';
import { raw, update } from './__fixtures__/workspace-fixture';

/** Workspace → Site updates, redesigned (18 Nov, ws-site-updates-desktop.png): every filter and link pressed. */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  signed: vi.fn(), doc: vi.fn(), ensure: vi.fn(), admins: vi.fn(), assign: vi.fn(), primary: vi.fn(), removeV: vi.fn(),
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
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (s: any) => s.name, substageLabel: (s: any) => s.name }) }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ docCategory: (c: string) => ({ boq: 'Bill of Quantities', receipt: 'Receipt', site_photo: 'Site Photo', contract: 'Contract' } as Record<string, string>)[c] ?? c, tier: (v: string) => v, country: (v: string) => v }) }));
vi.mock('@/lib/supabase/approvals', () => ({ getSignedEvidenceUrl: h.signed }));
vi.mock('@/lib/supabase/documents', () => ({ getSignedDocumentUrl: h.doc }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: 'mock-empty' }));

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
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let Page: any = null; let pageProps: any = {};
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: Page, props: pageProps, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const L = (k: string) => lookup(en as never, k) as string;
const strings = (view: Node[]) => view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');

import { SiteUpdatesTab } from '@/components/admin/workspace/SiteUpdatesTab';

const now = new Date('2026-09-14T09:00:00Z');
function loaded(over = {}) {
  return { workspace: assembleWorkspace(raw({ siteUpdates: { available: true, rows: [
    { ...update('s3', '2026-09-05T00:00:00Z'), description: 'Upper blockwork started.', evidencePaths: ['p1/a.jpg', 'p1/b.jpg'] },
    { ...update('s3', '2026-09-02T00:00:00Z'), submittedBy: 'owner', evidencePaths: [] },
    { ...update('s2', '2026-09-01T00:00:00Z'), substageId: 'sub-a', evidencePaths: ['p1/c.jpg'] },
  ] }, ...over } as never), now), errors: {} };
}
const cards = (view: any[]) => view.filter(n => n.type === 'li' && n.props.className?.includes('rounded-2xl'));
const filter = (view: any[], label: string) => view.find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n.props.children).startsWith(label))!;

beforeEach(() => {
  h.store = new Map(); Page = SiteUpdatesTab; pageProps = { loaded: loaded() };
  h.signed.mockReset().mockImplementation(async (p: string) => (p === 'p1/c.jpg' ? null : `https://signed/${p}`));
});

describe('Site updates, redesigned', () => {
  it('shows every update, grouped by day, newest first', async () => {
    const view = await settle();
    expect(cards(view)).toHaveLength(3);
    expect(view.filter(n => n.type === 'h2').map(n => text(n.props.children))).toHaveLength(3);
  });

  it('the stage filter narrows to that stage, with its count; All stages clears it', async () => {
    let view = await settle();
    const s3 = filter(view, '3 · Stage 3');
    expect(text(s3.props.children)).toContain('2');
    s3.props.onClick(); view = render();
    expect(cards(view)).toHaveLength(2);
    filter(view, L('admin.workspace.ui.allStages')).props.onClick(); view = render();
    expect(cards(view)).toHaveLength(3);
  });

  it('the reporter filter names each person with their role on the project', async () => {
    let view = await settle();
    const owner = filter(view, 'Charlotte Elame · Homeowner');
    expect(text(owner.props.children)).toContain('1');
    owner.props.onClick(); view = render();
    expect(cards(view)).toHaveLength(1);
    filter(view, 'Tonny Tawe · contractor').props.onClick(); view = render();
    expect(cards(view)).toHaveLength(2);
  });

  it('the stage pill opens that stage on Overview; photos open full size; an unsigned file is marked', async () => {
    let view = await settle();
    for (const e of h.effects) e.run(); await flush(); view = render();
    const to = view.filter(n => n.type === 'a' && n.props.to).map(n => n.props.to);
    expect(to).toContain('/admin/projects/p1?stage=s3');
    expect(to).toContain('/admin/projects/p1?stage=s2');
    const photos = view.filter(n => n.type === 'a' && n.props.href);
    expect(photos.map(p => p.props.href)).toEqual(['https://signed/p1/a.jpg', 'https://signed/p1/b.jpg']);
    expect(photos.every(p => p.props.target === '_blank')).toBe(true);
    expect(view.filter(n => n.type === 'span').map(n => text(n.props.children))).toContain(L('admin.workspace.ui.couldNotOpen'));
  });

  it('an update with no words says files only', async () => {
    expect(strings(await settle())).toContain(L('admin.workspace.siteUpdates.noDescription'));
  });

  it('empty and unavailable are still told apart', async () => {
    pageProps = { loaded: loaded({ siteUpdates: { available: true, rows: [] } }) };
    expect((await settle()).find(n => n.type === 'mock-empty')).toBeTruthy();
  });

  it('the new words are translated', () => {
    for (const k of ['today', 'yesterday', 'allStages', 'reportedBy', 'everyone', 'pillHint', 'couldNotOpen', 'noMatch']) {
      expect(lookup(fr as never, `admin.workspace.ui.${k}`), k).not.toBe(L(`admin.workspace.ui.${k}`));
    }
  });
});
