import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';
import { chatRole, filterChats, phoneLinks } from './whatsapp-crm';

/**
 * The WhatsApp CRM (18 Nov), every button pressed. The component is rendered with hooks
 * kept per component instance, so a click changes state the way it does in the browser and
 * the next render shows where it led.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { path: string; run: () => any }[],
  link: vi.fn(), send: vi.fn(), open: vi.fn(), openPerson: vi.fn(), person: vi.fn(), projects: vi.fn(), templates: [] as any[], contact: [] as any[],
}));
vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  const slot = () => { const list = h.store.get(h.path) ?? []; h.store.set(h.path, list); return { list, i: h.idx++ }; };
  return { ...real,
    useState: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = typeof initial === 'function' ? initial() : initial;
      return [list[i], (value: any) => { list[i] = typeof value === 'function' ? value(list[i]) : value; }]; },
    useRef: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = { current: initial }; return list[i]; },
    useEffect: (run: () => any) => { h.idx++; h.effects.push({ path: h.path, run }); },
    useMemo: (make: () => any) => { h.idx++; return make(); },
    useCallback: (callback: any) => { h.idx++; return callback; },
  };
});
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'ruth' } }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/format', () => ({ formatRelative: (value: string) => `rel(${value})` }));
vi.mock('@/lib/supabase/conversations', () => ({ linkConversation: h.link, sendConversationMessage: h.send }));
vi.mock('@/lib/supabase/admin-person', () => ({ fetchPersonRecord: h.person }));
vi.mock('@/lib/supabase/jalla-projects', () => ({ listProjectsForJalla: h.projects }));
vi.mock('@/lib/supabase/project-whatsapp', () => ({ openProjectWhatsApp: h.open, openPersonWhatsApp: h.openPerson }));
vi.mock('@/lib/supabase/client', () => {
  const query = (table: string): any => { const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    then: (ok: any) => Promise.resolve(ok({ data: table === 'communication_whatsapp_templates' ? h.templates : h.contact, error: null })) }; return chain; };
  return { supabase: { from: query } };
});
vi.mock('@/components/admin/conversations/ConversationThread', () => ({ ConversationThread: 'mock-thread' }));
vi.mock('@/components/admin/PersonPreview', () => ({ PersonPreview: 'mock-person-preview' }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: 'mock-empty' }));
import { WhatsAppCrm } from '@/components/admin/whatsapp/WhatsAppCrm';

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

const conv = (id: string, extra: Record<string, unknown> = {}) => ({ id, personId: `p-${id}`, projectId: null, channel: 'whatsapp', subject: null, status: 'open', assignedTo: null,
  ghlConversationId: null, lastMessageAt: '2026-11-18T09:31:00Z', resolvedAt: null, createdAt: '', ...extra });
const rows = [conv('claire', { status: 'waiting_on_us', assignedTo: 'ruth' }), conv('bob'), conv('new', { personId: null })];
const people = new Map<string, any>([['p-claire', { id: 'p-claire', fullName: 'Claire Mbala', email: 'claire@x.cm', roles: '' }], ['p-bob', { id: 'p-bob', fullName: 'Bob Ousmane', email: 'bob@x.cm', roles: 'contractor' }],
  ['u2', { id: 'u2', fullName: 'Second Contractor', email: 's@x.cm', roles: 'contractor' }],
  ['lead', { id: 'lead', fullName: 'Amina Ndi', email: 'amina@x.cm', roles: '', projectCount: 0 }], ['staff', { id: 'staff', fullName: 'Ruth', email: 'ruth@groundwork.cm', roles: 'admin' }]]);
const props = { rows, people, staff: [{ id: 'ruth', label: 'Ruth' }], staffName: (id: string | null) => (id === 'ruth' ? 'Ruth' : '—'),
  previews: new Map([['claire', { conversationId: 'claire', direction: 'inbound', content: 'Can I pay part 4 by MoMo?', createdAt: '' }]]),
  projectsByPerson: new Map([['p-claire', [{ id: 'proj1', name: 'Mbala Residence', status: 'active', tier: null, currentStage: 5, city: 'Douala', country: 'CM' }]]]),
  title: (c: any) => (c.personId ? people.get(c.personId)?.fullName : '+237 677 12 34 56') };
let selected: string | null = null;
const onSelect = vi.fn((id: string | null) => { selected = id; });
const onChanged = vi.fn(async () => {});
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: WhatsAppCrm, props: { ...props, selectedId: selected, onSelect, onChanged }, key: null }, 'root'); }
async function settle() { render(); for (const effect of h.effects) effect.run(); await flush(); return render(); }
const find = (view: Node[], test: (node: Node) => boolean) => view.find(test);
const action = (view: Node[], name: string) => find(view, node => node.props?.['data-action'] === name)!;

beforeEach(() => {
  h.store = new Map(); selected = null; onSelect.mockClear(); onChanged.mockClear(); h.templates = []; h.contact = [];
  h.link.mockReset().mockResolvedValue(undefined); h.send.mockReset().mockResolvedValue('m1');
  h.person.mockReset().mockResolvedValue({ account: { phone: '+237 699 12 34 56', email: 'claire@x.cm', signupCountry: 'CM', preferredLang: 'en' }, projects: [], onboarding: null, application: null });
  h.projects.mockReset().mockResolvedValue({ rows: [{ id: 'proj1', name: 'Mbala Residence', status: 'active', city: 'Douala', country: 'CM', currentStage: 5, ownerId: 'p-claire', ownerName: 'Claire Mbala', ownerEmail: null }], available: true });
  h.open.mockReset(); h.openPerson.mockReset();
  (globalThis as any).document = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
});

describe('the small decisions', () => {
  it('names each chat partner by their account, and a number with no account as new', () => {
    expect(chatRole(null, undefined)).toBe('new');
    expect(chatRole('a', '')).toBe('homeowner');
    expect(chatRole('a', 'contractor')).toBe('contractor');
    expect(chatRole('a', 'contractor,verifier')).toBe('verifier');
    expect(chatRole('a', 'admin')).toBe('staff');
  });
  it('builds call and WhatsApp links only from a usable number', () => {
    expect(phoneLinks('+237 699 12 34 56')).toEqual({ tel: 'tel:+237699123456', whatsapp: 'https://wa.me/237699123456' });
    expect(phoneLinks('123')).toBeNull();
    expect(phoneLinks(null)).toBeNull();
  });
  it('filters by needs reply, mine, new numbers and search', () => {
    const base = { me: 'ruth', title: props.title, preview: (id: string) => props.previews.get(id)?.content ?? '' };
    expect(filterChats(rows as never, { ...base, filter: 'needsReply', query: '' }).map(r => r.id)).toEqual(['claire']);
    expect(filterChats(rows as never, { ...base, filter: 'mine', query: '' }).map(r => r.id)).toEqual(['claire']);
    expect(filterChats(rows as never, { ...base, filter: 'newNumbers', query: '' }).map(r => r.id)).toEqual(['new']);
    expect(filterChats(rows as never, { ...base, filter: 'all', query: 'momo' }).map(r => r.id)).toEqual(['claire']);
  });
});

describe('every button on the WhatsApp page', () => {
  it('filter chips and search narrow the list', async () => {
    let view = await settle();
    const chats = () => view.filter(node => node.props?.['data-chat']).map(node => node.props['data-chat']);
    expect(chats()).toEqual(['claire', 'bob', 'new']);
    for (const [filter, expected] of [['needsReply', ['claire']], ['mine', ['claire']], ['newNumbers', ['new']], ['all', ['claire', 'bob', 'new']]] as const) {
      find(view, node => node.props?.['data-filter'] === filter)!.props.onClick(); view = render();
      expect(chats(), filter).toEqual(expected);
      expect(find(view, node => node.props?.['data-filter'] === filter)!.props['aria-pressed']).toBe(true);
    }
    find(view, node => node.type === 'input' && node.props.placeholder === 'Search name or message')!.props.onChange({ target: { value: 'bob' } }); view = render();
    expect(chats()).toEqual(['bob']);
  });

  it('a chat row opens that chat; back returns to the list', async () => {
    let view = await settle();
    find(view, node => node.props?.['data-chat'] === 'bob')!.props.onClick();
    expect(onSelect).toHaveBeenLastCalledWith('bob');
    view = await settle();
    expect(find(view, node => node.props?.['data-chat-open'])?.props['data-chat-open']).toBe('bob');
    expect(find(view, node => node.type === 'mock-thread')?.props.conversation.id).toBe('bob');
    action(view, 'back').props.onClick();
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('Call and Open in WhatsApp reach the person\'s real number', async () => {
    selected = 'claire';
    const view = await settle();
    expect(h.person).toHaveBeenCalledWith({ userId: 'p-claire' });
    expect(action(view, 'call').props.href).toBe('tel:+237699123456');
    expect(action(view, 'open-whatsapp').props.href).toBe('https://wa.me/237699123456');
    expect(action(view, 'open-whatsapp').props.target).toBe('_blank');
  });

  it('Full profile opens the person preview; Open project goes to the project', async () => {
    selected = 'claire';
    let view = await settle();
    expect(action(view, 'open-project').props.to).toBe('/admin/projects/proj1');
    action(view, 'full-profile').props.onClick(); view = render();
    expect(find(view, node => node.type === 'mock-person-preview')?.props.reference).toEqual({ userId: 'p-claire' });
  });

  it('Link to this chat links the project and refreshes', async () => {
    selected = 'claire';
    const view = await settle();
    await action(view, 'link-project').props.onClick(); await flush();
    expect(h.link).toHaveBeenCalledWith('claire', 'proj1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('Log a call saves the call into the chat as a staff note', async () => {
    selected = 'claire';
    let view = await settle();
    action(view, 'log-call').props.onClick(); view = render();
    const form = () => find(view, node => node.props?.['data-call-form'] !== undefined && node.type === 'form')!;
    find(view, node => node.type === 'input' && node.props.inputMode === 'numeric')!.props.onChange({ target: { value: '4' } }); view = render();
    find(view, node => node.type === 'textarea')!.props.onChange({ target: { value: 'Site visit Friday 10:00' } }); view = render();
    await form().props.onSubmit({ preventDefault() {} }); await flush();
    expect(h.send).toHaveBeenCalledWith('claire', 'Call logged · 4 min\nSite visit Friday 10:00', 'internal');
    expect(onChanged).toHaveBeenCalled();
    expect(find(render(), node => node.props?.['data-call-form'] !== undefined && node.type === 'form')).toBeUndefined();
  });

  it('shows consent only where the WhatsApp contact record exists', async () => {
    selected = 'claire';
    const rowsShown = (view: Node[]) => Object.fromEntries(view.filter(node => node.type?.name === 'Row').map(node => [node.props.label, node.props.value]));
    let view = await settle();
    expect(rowsShown(view)).toMatchObject({ Phone: '+237 699 12 34 56', Owner: 'Ruth' });
    expect(rowsShown(view)['WhatsApp consent']).toBeUndefined();
    h.store = new Map(); h.contact = [{ consent_at: '2026-11-02', opted_out_at: null, automation_paused: true }];
    view = await settle();
    expect(rowsShown(view)).toMatchObject({ 'WhatsApp consent': 'Given rel(2026-11-02)', 'Automatic messages': 'Paused' });
  });

  it('the Templates tab lists templates; Connection settings goes to the existing setup page', async () => {
    h.templates = [{ name: 'stage_update', language: 'en', status: 'APPROVED', checked_at: '2026-11-17' }];
    let view = await settle();
    expect(action(view, 'connection-settings').props.to).toBe('/admin/sequences?tab=whatsapp');
    find(view, node => node.props?.['data-tab'] === 'templates')!.props.onClick();
    view = await settle();
    expect(text(find(view, node => node.type === 'table'))).toContain('stage_update');
    find(view, node => node.props?.['data-tab'] === 'chats')!.props.onClick(); view = render();
    expect(view.some(node => node.props?.['data-chat'])).toBe(true);
  });

  it('New chat: pick a project, pick who, and the chat opens', async () => {
    h.open.mockResolvedValue({ ok: true, conversationId: 'fresh', created: true });
    let view = await settle();
    action(view, 'new-chat').props.onClick(); view = await settle();
    expect(find(view, node => node.props?.['data-new-chat'] !== undefined)).toBeTruthy();
    find(view, node => node.props?.['data-source'] === 'project')!.props.onClick(); view = await settle();
    find(view, node => node.props?.['data-project'] === 'proj1')!.props.onClick(); view = render();
    await find(view, node => node.props?.['data-role'] === 'client')!.props.onClick(); await flush();
    expect(h.open).toHaveBeenCalledWith('proj1', 'client', undefined);
    expect(onChanged).toHaveBeenCalled();
    expect(onSelect).toHaveBeenLastCalledWith('fresh');
    expect(find(render(), node => node.props?.['data-new-chat'] !== undefined)).toBeUndefined();
  });

  it('New chat: when several people hold the role, the admin picks one by name', async () => {
    h.open.mockResolvedValueOnce({ ok: false, reason: 'choose_person', candidates: ['p-bob', 'u2'] }).mockResolvedValueOnce({ ok: true, conversationId: 'bob2', created: false });
    let view = await settle();
    action(view, 'new-chat').props.onClick(); view = await settle();
    find(view, node => node.props?.['data-source'] === 'project')!.props.onClick(); view = await settle();
    find(view, node => node.props?.['data-project'] === 'proj1')!.props.onClick(); view = render();
    await find(view, node => node.props?.['data-role'] === 'contractor')!.props.onClick(); await flush(); view = render();
    expect(view.filter(node => node.props?.['data-candidate']).map(node => text(node.props.children))).toEqual(['Bob Ousmane', 'Second Contractor']);
    await find(view, node => node.props?.['data-candidate'] === 'u2')!.props.onClick(); await flush();
    expect(h.open).toHaveBeenLastCalledWith('proj1', 'contractor', 'u2');
    expect(onSelect).toHaveBeenLastCalledWith('bob2');
  });

  it('New chat: a refusal is said in words; Change and the close button work', async () => {
    h.open.mockResolvedValue({ ok: false, reason: 'no_phone' });
    let view = await settle();
    action(view, 'new-chat').props.onClick(); view = await settle();
    find(view, node => node.props?.['data-source'] === 'project')!.props.onClick(); view = await settle();
    find(view, node => node.props?.['data-project'] === 'proj1')!.props.onClick(); view = render();
    await find(view, node => node.props?.['data-role'] === 'verifier')!.props.onClick(); await flush(); view = render();
    expect(text(find(view, node => node.props?.role === 'alert'))).toBe(en.admin.workspace.header.whatsappFail.no_phone);
    action(view, 'change-project').props.onClick(); view = render();
    expect(find(view, node => node.props?.['data-project'] === 'proj1')).toBeTruthy();
    find(view, node => node.type === 'button' && node.props['aria-label'] === 'Close')!.props.onClick(); view = render();
    expect(find(view, node => node.props?.['data-new-chat'] !== undefined)).toBeUndefined();
  });

  it('New chat opens on Users: everyone who signed up except staff, searchable, one tap to chat', async () => {
    h.openPerson.mockResolvedValue({ ok: true, conversationId: 'direct', created: true });
    let view = await settle();
    action(view, 'new-chat').props.onClick(); view = await settle();
    expect(find(view, node => node.props?.['data-source'] === 'users')!.props['aria-pressed']).toBe(true);
    const listed = () => view.filter(node => node.props?.['data-person']).map(node => node.props['data-person']);
    expect(listed()).toEqual(['lead', 'p-bob', 'p-claire', 'u2']);
    find(view, node => node.type === 'input' && node.props.placeholder === 'Search everyone who signed up')!.props.onChange({ target: { value: 'amina' } }); view = render();
    expect(listed()).toEqual(['lead']);
    await find(view, node => node.props?.['data-person'] === 'lead')!.props.onClick(); await flush();
    expect(h.openPerson).toHaveBeenCalledWith('lead');
    expect(h.open).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenLastCalledWith('direct');
  });

  it('New chat → Contractors lists only contractors; a refusal is said in words', async () => {
    h.openPerson.mockResolvedValue({ ok: false, reason: 'no_phone' });
    let view = await settle();
    action(view, 'new-chat').props.onClick(); view = await settle();
    find(view, node => node.props?.['data-source'] === 'contractors')!.props.onClick(); view = render();
    expect(view.filter(node => node.props?.['data-person']).map(node => node.props['data-person'])).toEqual(['p-bob', 'u2']);
    await find(view, node => node.props?.['data-person'] === 'u2')!.props.onClick(); await flush(); view = render();
    expect(h.openPerson).toHaveBeenCalledWith('u2');
    expect(text(find(view, node => node.props?.role === 'alert'))).toBe(en.admin.workspace.header.whatsappFail.no_phone);
    expect(find(view, node => node.props?.['data-new-chat'] !== undefined)).toBeTruthy();
  });
});
