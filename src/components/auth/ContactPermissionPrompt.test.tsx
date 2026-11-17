import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, ei: 0,
  user: null as any, fetch: vi.fn(), set: vi.fn(), later: new Set<string>(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((v, k) => !Object.is(v, h.deps[i][k]))) {
    h.deps[i] = deps; h.effects.push({ index: i, effect }); } },
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => lookup(en as never, key) as string }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/lib/auth/contact-permission', async original => ({ ...await original<typeof import('@/lib/auth/contact-permission')>(),
  fetchContactPermission: h.fetch, setContactPermission: h.set,
  askedLaterThisSession: (id: string) => h.later.has(id), askLaterThisSession: (id: string) => { h.later.add(id); } }));
import { ContactPermissionPrompt } from './ContactPermissionPrompt';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''; }
function render() {
  h.si = h.ri = h.ei = 0;
  const tree = ContactPermissionPrompt();
  for (const { index, effect } of h.effects.splice(0)) { h.cleanups[index]?.(); h.cleanups[index] = effect(); }
  return nodes(tree);
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function signIn(user: any, recorded: boolean | null | undefined) { h.user = user; h.fetch.mockResolvedValue(recorded); render(); await flush(); return render(); }
const button = (view: Node[], label: string) => view.find(node => node.type === 'button' && text(node) === label);
const person = { id: 'existing-user', user_metadata: {} };

beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.effects = []; h.later.clear(); h.set.mockImplementation(async (allowed: boolean) => allowed); });
afterEach(() => { h.cleanups.forEach(cleanup => cleanup?.()); });

describe('the one-time question after signing in', () => {
  it('asks an existing account that never answered', async () => {
    const view = await signIn(person, null);
    expect(view.find(node => node.props.role === 'dialog')).toBeTruthy();
    expect(text(view)).toContain('May we call or message you?');
  });

  it.each([[true], [false]])('records %s with where it was given, then gets out of the way', async allowed => {
    const view = await signIn(person, null);
    button(view, allowed ? 'Yes, you may contact me' : 'No, thanks')!.props.onClick(); await flush();
    expect(h.set).toHaveBeenCalledWith(allowed, 'sign_in');
    expect(render()).toEqual([]);
  });

  it('puts the question away until the next sign-in, and records nothing', async () => {
    const view = await signIn(person, null);
    button(view, 'Ask me later')!.props.onClick();
    expect(h.set).not.toHaveBeenCalled();
    expect(render()).toEqual([]);
    expect(h.later.has('existing-user')).toBe(true);
    h.state = []; h.refs = []; h.deps = [];
    expect(await signIn(person, null)).toEqual([]);
  });

  it('treats Escape as "ask me later", never as a no', async () => {
    const view = await signIn(person, null);
    view[0].props.onKeyDown({ key: 'Escape' });
    expect(h.set).not.toHaveBeenCalled();
    expect(render()).toEqual([]);
  });

  it('keeps the question open and says so when the answer cannot be saved', async () => {
    h.set.mockRejectedValue(new Error('network'));
    const view = await signIn(person, null);
    button(view, 'Yes, you may contact me')!.props.onClick(); await flush();
    expect(text(render())).toContain('Your answer could not be saved.');
    expect(render().find(node => node.props.role === 'dialog')).toBeTruthy();
  });

  it.each([[true], [false]])('never asks somebody who already answered %s', async recorded => {
    expect(await signIn(person, recorded)).toEqual([]);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('copies a new account’s signup answer across silently instead of asking again', async () => {
    const view = await signIn({ id: 'new-user', user_metadata: { contact_permission: false } }, null);
    expect(view).toEqual([]);
    expect(h.set).toHaveBeenCalledWith(false, 'signup');
  });

  it('stays quiet when the answer cannot be read, rather than asking on every page', async () => {
    expect(await signIn(person, undefined)).toEqual([]);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('does nothing while nobody is signed in', async () => {
    expect(await signIn(null, null)).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
