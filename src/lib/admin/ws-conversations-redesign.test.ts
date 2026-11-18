import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { assembleWorkspace } from './workspace';
import { raw, conv, decision } from './__fixtures__/workspace-fixture';

/** Workspace → Conversations, redesigned (18 Nov, ws-conversations-desktop.png): three panes, every link and act. */

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

vi.mock('@/lib/format', async o => ({ ...(await o<any>()), formatRelative: () => '2 h ago' }));
vi.mock('@/lib/supabase/conversations', () => ({ ensureProjectConversation: h.ensure, assignConversation: vi.fn(), listConversationMessages: vi.fn(), resolveConversation: vi.fn(), sendConversationMessage: vi.fn() }));
vi.mock('@/lib/supabase/messages', () => ({ subscribeToMessages: vi.fn() }));
vi.mock('@/lib/supabase/admin-users', () => ({ listAdminUsers: h.admins }));
vi.mock('@/components/admin/conversations/ConversationThread', () => ({ ConversationThread: 'mock-thread' }));
import { ConversationsTab } from '@/components/admin/workspace/ConversationsTab';

const THREADS = [conv('c1', { subject: 'Project thread', assignedTo: 'admin' }), conv('c2', { channel: 'whatsapp' as never, status: 'open' }), conv('c3', { subject: 'Stage 5 parts', status: 'resolved' })];
function loaded(rows = THREADS, decisions = [decision('d1'), decision('d2', { conversationId: null, supersedesId: 'd1', related: 'payment', relatedId: null })]) {
  return { workspace: assembleWorkspace(raw({ conversations: { available: true, rows }, decisions: { available: true, rows: decisions } } as never), new Date('2026-09-14T09:00:00Z')), errors: {} };
}
const onChanged = vi.fn();

beforeEach(() => {
  h.store = new Map(); Page = ConversationsTab; pageProps = { loaded: loaded(), conversationId: null, onChanged };
  h.admins.mockReset().mockResolvedValue([{ id: 'admin', fullName: 'Ruth', email: 'r@x', roles: 'admin' }]);
  h.ensure.mockReset().mockResolvedValue('c9'); onChanged.mockReset();
});

describe('Conversations, redesigned', () => {
  it('lists every thread of this project, each opening itself in this tab; the first is open by default', async () => {
    const view = await settle();
    const links = view.filter(n => n.type === 'a' && n.props.to?.includes('conversation=')).map(n => n.props.to);
    expect(links).toEqual(expect.arrayContaining(THREADS.map(c => `/admin/projects/p1?tab=conversations&conversation=${c.id}`)));
    expect(view.find(n => n.type === 'mock-thread')?.props.conversation.id).toBe('c1');
  });

  it('the thread named in the URL is the one shown, and is marked current', async () => {
    pageProps = { ...pageProps, conversationId: 'c3' };
    const view = await settle();
    expect(view.find(n => n.type === 'mock-thread')?.props.conversation.id).toBe('c3');
    expect(view.filter(n => n.type === 'a' && n.props['aria-current'] === 'true').map(n => n.props.to)).toEqual(['/admin/projects/p1?tab=conversations&conversation=c3']);
  });

  it('the thread still gets the staff list, the decision context and realtime', async () => {
    let view = await settle(); for (const e of h.effects) e.run(); await flush(); view = render();
    const th = view.find(n => n.type === 'mock-thread')!;
    expect(th.props.staff).toEqual([{ id: 'admin', label: 'Ruth' }]);
    expect(th.props.decision.projectId).toBe('p1');
    expect(th.props.realtimeProjectId).toBe('p1');
  });

  it('the decision log sits beside the thread, every fact shown, and Open thread goes to its conversation', async () => {
    const view = await settle();
    const facts = view.filter(n => n.type === 'span' && n.props.className?.includes('rounded-md')).map(n => text(n.props.children));
    expect(facts.some(f => f.includes('cost'))).toBe(true);
    expect(facts).toContain(L('admin.decision.supersedes'));
    const open = view.filter(n => n.type === 'a' && text(n.props.children) === L('admin.decision.openThread'));
    expect(open.map(a => a.props.to)).toEqual(['/admin/projects/p1?tab=conversations&conversation=c1']);
  });

  it('with no thread, Start the project thread creates it and reloads', async () => {
    pageProps = { loaded: loaded([], []), conversationId: null, onChanged };
    const view = await settle();
    const empty = view.find(n => n.type === 'mock-empty')!;
    await empty.props.action.props.onClick(); await flush();
    expect(h.ensure).toHaveBeenCalledWith('p1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('the pane headings are translated', () => {
    for (const k of ['threads']) expect(lookup(fr as never, `admin.workspace.ui.${k}`)).not.toBe(L(`admin.workspace.ui.${k}`));
  });
});
