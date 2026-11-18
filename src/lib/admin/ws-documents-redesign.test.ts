import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { assembleWorkspace } from './workspace';
import { raw, doc } from './__fixtures__/workspace-fixture';

/** Workspace → Documents, redesigned (18 Nov, ws-documents-desktop.png): search, chips, More, grid/list, every file link. */

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

import { DocumentsTab } from '@/components/admin/workspace/DocumentsTab';

const DOCS = [
  doc('d1', 'boq', 'Mbala-BOQ.pdf'), doc('d2', 'contract', 'Contrat.pdf'), doc('d3', 'permit', 'Permis.pdf'),
  doc('d4', 'receipt', 'Recu-MoMo.jpg', { stage_id: 's2' }), doc('d5', 'site_photo', 'north-wall.jpg'), doc('d6', 'other', 'plan-scan.tif', { mime_type: 'image/tiff' }),
];
function loaded(rows = DOCS) {
  return { workspace: assembleWorkspace(raw({ documents: { available: true, rows } } as never), new Date('2026-09-14T09:00:00Z')), errors: {} };
}
const files = (view: any[]) => view.filter(n => n.type === 'span' && n.props.title && /\.(pdf|jpg|tif)$/.test(n.props.title)).map(n => n.props.title);
const chip = (view: any[], label: string) => view.find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n.props.children).startsWith(label))!;

beforeEach(() => {
  h.store = new Map(); Page = DocumentsTab; pageProps = { loaded: loaded() };
  h.doc.mockReset().mockImplementation(async (p: string) => (p.endsWith('.tif') ? null : `https://signed/${p}`));
});

describe('Documents, redesigned', () => {
  it('every category with files is a group, BoQ first', async () => {
    const view = await settle();
    expect(view.filter(n => n.type === 'h2').map(n => text(n.props.children).replace(/\s*\d+$/, ''))).toEqual(
      ['Bill of Quantities', 'Contract', 'permit', 'Receipt', 'Site Photo', 'other'].map(x => x.trim()));
    expect(files(view)).toHaveLength(6);
  });

  it('search narrows by file name', async () => {
    let view = await settle();
    view.find(n => n.type === 'input')!.props.onChange({ target: { value: 'recu' } }); view = render();
    expect(files(view)).toEqual(['Recu-MoMo.jpg']);
    view.find(n => n.type === 'input')!.props.onChange({ target: { value: 'nothing-like-this' } }); view = render();
    expect(strings(view)).toContain(L('admin.workspace.ui.noMatch'));
  });

  it('a category chip shows only that category; pressing it again, or All, clears it; More reveals the rest', async () => {
    let view = await settle();
    expect(view.filter(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && !n.props['aria-label']).map(n => text(n.props.children)))
      .toEqual(['All6', 'Bill of Quantities1', 'Contract1', 'permit1']);
    chip(view, 'Contract').props.onClick(); view = render();
    expect(files(view)).toEqual(['Contrat.pdf']);
    chip(view, 'Contract').props.onClick(); view = render();
    expect(files(view)).toHaveLength(6);
    view.find(n => n.type === 'button' && text(n.props.children) === L('admin.workspace.ui.more'))!.props.onClick(); view = render();
    chip(view, 'Site Photo').props.onClick(); view = render();
    expect(files(view)).toEqual(['north-wall.jpg']);
    chip(view, L('admin.workspace.ui.all')).props.onClick(); view = render();
    expect(files(view)).toHaveLength(6);
  });

  it('grid and list show the same files', async () => {
    let view = await settle();
    view.find(n => n.props?.['aria-label'] === L('admin.workspace.ui.list'))!.props.onClick(); view = render();
    expect(view.filter(n => n.type === 'li' && n.props.className?.includes('px-5'))).toHaveLength(6);
  });

  it('each file opens in a new tab when it signs, is marked when it does not, and a stage link opens Overview', async () => {
    let view = await settle(); for (const e of h.effects) e.run(); await flush(); view = render();
    const opens = view.filter(n => n.type === 'a' && n.props.href);
    expect(opens.every(a => a.props.target === '_blank')).toBe(true);
    expect(opens.map(a => a.props.href)).toContain('https://signed/p1/Contrat.pdf');
    expect(view.some(n => n.props?.['aria-label'] === L('admin.workspace.documents.unsigned'))).toBe(true);
    expect(view.filter(n => n.type === 'a' && n.props.to).map(n => n.props.to)).toContain('/admin/projects/p1?stage=s2');
  });

  it('empty is still the empty state, and read-only is still said', async () => {
    expect((await settle()).filter(n => n.type === 'p').map(n => text(n.props.children))).toContain(L('admin.workspace.documents.readOnly'));
    pageProps = { loaded: loaded([]) }; h.store = new Map();
    expect((await settle()).find(n => n.type === 'mock-empty')).toBeTruthy();
  });

  it('the new words are translated', () => {
    for (const k of ['all', 'searchFiles', 'more', 'grid', 'list']) expect(lookup(fr as never, `admin.workspace.ui.${k}`), k).not.toBe(L(`admin.workspace.ui.${k}`));
  });
});
