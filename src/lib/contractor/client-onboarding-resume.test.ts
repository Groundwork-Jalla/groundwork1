import { createElement, isValidElement, type EffectCallback, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import {
  clientProjectDraftKey, readClientOnboardingDraft, saveClientOnboardingDraft,
} from './client-onboarding-draft';
import { readWizardDraft, writeWizardDraft, type WizardDraft } from '@/lib/projects/wizard-draft';

type EffectSlot = { deps: readonly unknown[] | undefined; cleanup?: () => void };
type DriverState = {
  cursor: number; values: unknown[]; effects: Map<number, EffectSlot>;
  queued: { index: number; effect: EffectCallback; deps: readonly unknown[] | undefined }[];
  dirty: boolean;
};
const h = vi.hoisted(() => ({
  actor: 'contractor-a', driver: null as DriverState | null,
  fetchPending: vi.fn(), invite: vi.fn(),
}));

// The project has no browser renderer dependency. Drive the route's actual hooks and
// event handlers with committed effect dependencies, retaining state across renders
// and running cleanups on unmount/account changes. Children remain inspectable JSX.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const driver = h.driver!;
    const index = driver.cursor++;
    if (!(index in driver.values)) driver.values[index] = typeof initial === 'function' ? initial() : initial;
    return [driver.values[index], (value: unknown) => {
      const previous = driver.values[index];
      const next = typeof value === 'function' ? value(previous) : value;
      if (!Object.is(previous, next)) { driver.values[index] = next; driver.dirty = true; }
    }];
  },
  useRef: (initial: unknown) => {
    const driver = h.driver!;
    const index = driver.cursor++;
    if (!(index in driver.values)) driver.values[index] = { current: initial };
    return driver.values[index];
  },
  useEffect: (effect: EffectCallback, deps?: readonly unknown[]) => {
    const driver = h.driver!;
    const index = driver.cursor++;
    const previous = driver.effects.get(index);
    if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length
      || deps.some((value, i) => !Object.is(value, previous.deps![i]))) {
      driver.queued.push({ index, effect, deps });
    }
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: h.actor } }) }));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string>) => params ? `${key} ${JSON.stringify(params)}` : key,
}));
vi.mock('@/lib/supabase/contractor-clients', () => ({
  fetchPendingClients: () => h.fetchPending(),
  inviteMyClient: (...args: unknown[]) => h.invite(...args),
  InviteClientFailed: class extends Error { constructor(public code: string) { super(code); } },
}));
vi.mock('@/lib/supabase/contractor-onboarding', () => ({
  onboardingAvailable: async () => true, fetchOnboardingStatus: async () => ({ complete: true }),
}));
// The architecture-plan gate animates its slides; this renderer cannot mount a real
// motion component, and an unrendered gate looks exactly like a missing one.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown> & { children?: unknown }) =>
      createElement(tag, rest as Record<string, unknown>, children as never),
  }),
}));
vi.mock('@/contexts/WizardContext', () => ({ WizardProvider: () => null }));
vi.mock('@/app/routes/admin/projects.new', () => ({ ManagedWizard: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));
vi.mock('@/components/ui/input', () => ({ Input: () => null }));
vi.mock('@/components/ui/label', () => ({ Label: () => null }));

import WorkNewClient from '@/app/routes/work/clients.new';

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

class RouteDriver implements DriverState {
  cursor = 0;
  values: unknown[] = [];
  effects = new Map<number, EffectSlot>();
  queued: DriverState['queued'] = [];
  dirty = true;
  tree: unknown;

  render() {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error('Route did not settle');
      this.cursor = 0;
      this.dirty = false;
      this.queued = [];
      h.driver = this;
      try { this.tree = WorkNewClient(); } finally { h.driver = null; }
      for (const pending of this.queued) {
        this.effects.get(pending.index)?.cleanup?.();
        const cleanup = pending.effect();
        this.effects.set(pending.index, {
          deps: pending.deps, ...(typeof cleanup === 'function' ? { cleanup } : {}),
        });
      }
    } while (this.dirty);
  }

  async settle() {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      if (this.dirty) this.render();
    }
  }

  unmount() { for (const effect of this.effects.values()) effect.cleanup?.(); }
  all() { return elements(this.tree); }
  find(predicate: (element: Element) => boolean) {
    const match = this.all().find(predicate);
    if (!match) throw new Error(`Element not found in: ${text(this.tree)}`);
    return match;
  }
  change(id: string, value: string) {
    const input = this.find(element => element.props.id === id);
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
    this.render();
  }
  /**
   * Answer the architecture-plan question that now precedes the wizard.
   *
   * Reads the callback off the element, the same way `wizard()` reads persistenceKey:
   * this renderer records components as elements and never calls them, so a mocked
   * gate's capture would never run.
   */
  answerPlan(answer: unknown) {
    const gate = this.find(element => typeof element.props.onAnswered === 'function');
    (gate.props.onAnswered as (a: unknown) => void)(answer);
    this.render();
  }
  click(label: string) {
    const button = this.find(element => typeof element.props.onClick === 'function' && text(element) === label);
    (button.props.onClick as () => void)();
    this.render();
  }
  submit() {
    const form = this.find(element => element.type === 'form');
    const pending = (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    this.render();
    return pending;
  }
  wizard() { return this.find(element => typeof element.props.persistenceKey === 'string'); }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    clear: () => { values.clear(); },
    key: index => [...values.keys()][index] ?? null,
  };
}
const clientA = { clientId: 'client-a', fullName: 'Ada Client', email: 'ada@example.com', invitedAt: '2026-10-15T00:00:00Z' };
const clientB = { clientId: 'client-b', fullName: 'Bola Client', email: 'bola@example.com', invitedAt: '2026-10-16T00:00:00Z' };
function saveActive(client = clientA, phase: 'confirmation' | 'wizard' = 'confirmation') {
  saveClientOnboardingDraft(h.actor, { clientId: client.clientId, fullName: client.fullName, email: client.email, phase });
}
function projectDraft(name: string): WizardDraft {
  return { version: 1, step: 8, direction: 'forward', data: {
    ...WIZARD_DEFAULT_DATA, projectName: name, city: 'Buea', sqm: 120,
  } };
}
async function mount() { const driver = new RouteDriver(); driver.render(); await driver.settle(); return driver; }
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = 'contractor-a';
  h.driver = null;
  h.fetchPending.mockResolvedValue([]);
  h.invite.mockResolvedValue({ clientId: clientA.clientId });
  const storage = memoryStorage();
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('window', { sessionStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe('contractor client onboarding route resume', () => {
  it('returns to Next after account creation and navigation without inviting the client again', async () => {
    const first = await mount();
    first.change('clientName', clientA.fullName);
    first.change('clientEmail', clientA.email);
    await first.submit();
    first.render();
    expect(text(first.tree)).toContain('contractorClient.continueToWizard');
    expect(h.invite).toHaveBeenCalledExactlyOnceWith(clientA.fullName, clientA.email);
    expect(readClientOnboardingDraft(h.actor)?.phase).toBe('confirmation');

    first.unmount();
    h.fetchPending.mockResolvedValue([clientA]);
    const returned = await mount();
    expect(text(returned.tree)).toContain('contractorClient.continueToWizard');
    expect(text(returned.tree)).toContain(clientA.fullName);
    expect(text(returned.tree)).toContain(clientA.email);
    expect(h.invite).toHaveBeenCalledTimes(1);
    returned.click('contractorClient.continueToWizard');
    // The architecture-plan question now stands between the account and the wizard.
    // Answering NO is the path these resume tests are about.
    returned.answerPlan({ hasPlan: false });
    expect(returned.wizard().props.persistenceKey).toBe(clientProjectDraftKey(h.actor, clientA.clientId));
    expect(returned.wizard().props.onBehalfOf).toMatchObject({ userId: clientA.clientId, tier: 'self_verify', by: 'partner' });
    expect(readClientOnboardingDraft(h.actor)?.phase).toBe('wizard');
    returned.unmount();
  });

  it('reopens the saved wizard with the actor/client key and leaves its answers intact', async () => {
    saveActive(clientA, 'wizard');
    const key = clientProjectDraftKey(h.actor, clientA.clientId);
    writeWizardDraft(key, projectDraft('Ada house'));
    h.fetchPending.mockResolvedValue([clientA]);
    const returned = await mount();
    expect(returned.wizard().props.persistenceKey).toBe(key);
    expect(readWizardDraft(returned.wizard().props.persistenceKey as string)).toEqual(projectDraft('Ada house'));
    expect(text(returned.tree)).not.toContain('contractorClient.continueToWizard');
    expect(h.invite).not.toHaveBeenCalled();
    returned.unmount();
  });

  it('recovers a sole client account created before browser drafts were supported', async () => {
    h.fetchPending.mockResolvedValue([clientA]);
    const returned = await mount();
    expect(text(returned.tree)).toContain('contractorClient.continueToWizard');
    expect(readClientOnboardingDraft(h.actor)).toMatchObject({ clientId: clientA.clientId, phase: 'confirmation' });
    expect(h.invite).not.toHaveBeenCalled();
    returned.unmount();
  });

  it('rejects an unauthorized saved client and only resumes a server-approved account', async () => {
    saveActive({ ...clientA, clientId: 'unrelated-client', fullName: 'Unauthorized Person', email: 'private@example.com' }, 'wizard');
    h.fetchPending.mockResolvedValue([clientB]);
    const returned = await mount();
    expect(returned.all().some(element => typeof element.props.persistenceKey === 'string')).toBe(false);
    expect(text(returned.tree)).not.toContain('Unauthorized Person');
    expect(text(returned.tree)).not.toContain('private@example.com');
    expect(returned.find(element => element.props.id === 'clientName').props.value).toBe('');
    expect(readClientOnboardingDraft(h.actor)).toMatchObject({ clientId: null, phase: 'details' });
    returned.click('contractorClient.resumeCta');
    // Picking a client from the pending list has not answered the architecture-plan
    // question for them — that is put on the way into the wizard.
    returned.answerPlan({ hasPlan: false });
    expect(returned.wizard().props.onBehalfOf).toMatchObject({ userId: clientB.clientId });
    expect(h.invite).not.toHaveBeenCalled();
    returned.unmount();
  });

  it('can switch pending clients while keeping both project drafts separate', async () => {
    saveActive(clientA, 'wizard');
    const keyA = clientProjectDraftKey(h.actor, clientA.clientId);
    const keyB = clientProjectDraftKey(h.actor, clientB.clientId);
    writeWizardDraft(keyA, projectDraft('Ada house'));
    writeWizardDraft(keyB, projectDraft('Bola house'));
    h.fetchPending.mockResolvedValue([clientA, clientB]);
    const route = await mount();
    (route.wizard().props.onChangeClient as () => void)();
    route.render();
    expect(readWizardDraft(keyA)).toEqual(projectDraft('Ada house'));
    const bola = route.find(element => element.type === 'li' && text(element).includes(clientB.fullName));
    const button = elements(bola).find(element => typeof element.props.onClick === 'function')!;
    (button.props.onClick as () => void)();
    route.render();
    expect(route.wizard().props.persistenceKey).toBe(keyB);
    expect(readWizardDraft(keyB)).toEqual(projectDraft('Bola house'));
    expect(readWizardDraft(keyA)).toEqual(projectDraft('Ada house'));
    route.unmount();
    const returned = await mount();
    expect(returned.wizard().props.persistenceKey).toBe(keyB);
    returned.unmount();
  });

  it('clears the active-client pointer on wizard completion and does not reopen the completed client', async () => {
    saveActive(clientA, 'wizard');
    h.fetchPending.mockResolvedValue([clientA]);
    const route = await mount();
    (route.wizard().props.onReset as () => void)();
    expect(readClientOnboardingDraft(h.actor)).toBeNull();
    route.unmount();
    h.fetchPending.mockResolvedValue([]);
    const returned = await mount();
    expect(returned.all().some(element => typeof element.props.persistenceKey === 'string')).toBe(false);
    expect(returned.find(element => element.props.id === 'clientName').props.value).toBe('');
    expect(h.invite).not.toHaveBeenCalled();
    returned.unmount();
  });

  it('keeps a delayed invitation isolated after the signed-in contractor changes', async () => {
    const invitation = defer<{ clientId: string }>();
    h.invite.mockReturnValue(invitation.promise);
    const route = await mount();
    route.change('clientName', clientA.fullName);
    route.change('clientEmail', clientA.email);
    const pending = route.submit();
    h.actor = 'contractor-b';
    route.render();
    await route.settle();
    invitation.resolve({ clientId: clientA.clientId });
    await pending;
    await route.settle();

    expect(text(route.tree)).not.toContain(clientA.fullName);
    expect(text(route.tree)).not.toContain(clientA.email);
    expect(route.all().some(element => typeof element.props.persistenceKey === 'string')).toBe(false);
    expect(readClientOnboardingDraft('contractor-a')).toMatchObject({ clientId: clientA.clientId, phase: 'confirmation' });
    expect(readClientOnboardingDraft('contractor-b')).toMatchObject({ clientId: null, phase: 'details' });
    route.unmount();
  });

  it('preserves the saved account during a failed server lookup and restores Next on retry', async () => {
    saveActive(clientA);
    h.fetchPending.mockRejectedValueOnce(new Error('Offline'));
    const route = await mount();
    expect(text(route.tree)).toContain('contractorClient.resumeFailed');
    expect(readClientOnboardingDraft(h.actor)).toMatchObject({ clientId: clientA.clientId, phase: 'confirmation' });
    h.fetchPending.mockResolvedValue([clientA]);
    route.click('common.retry');
    await route.settle();
    expect(text(route.tree)).toContain('contractorClient.continueToWizard');
    expect(h.invite).not.toHaveBeenCalled();
    route.unmount();
  });
});
