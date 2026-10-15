import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearClientOnboardingDraft,
  clientProjectDraftKey,
  readClientOnboardingDraft,
  saveClientOnboardingDraft,
  type ClientOnboardingDraft,
} from './client-onboarding-draft';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
    clear: () => { items.clear(); },
    key: (index) => [...items.keys()][index] ?? null,
  };
}

const confirmation: ClientOnboardingDraft = {
  clientId: 'client-1',
  fullName: 'Ada Client',
  email: 'ada@example.com',
  phase: 'confirmation',
};

describe('contractor client onboarding drafts', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { sessionStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['confirmation', 'wizard'] as const)('restores the %s phase with the created client', (phase) => {
    const draft = { ...confirmation, phase };
    saveClientOnboardingDraft('contractor-1', draft);

    expect(readClientOnboardingDraft('contractor-1')).toEqual(draft);
    expect(JSON.parse(storage.getItem(storage.key(0)!)!)).toEqual({ version: 1, draft });
  });

  it('restores incomplete client details before an account has been created', () => {
    const draft: ClientOnboardingDraft = { clientId: null, fullName: 'Ada', email: '', phase: 'details' };
    saveClientOnboardingDraft('contractor-1', draft);
    expect(readClientOnboardingDraft('contractor-1')).toEqual(draft);
  });

  it('keeps drafts isolated between signed-in contractors', () => {
    saveClientOnboardingDraft('contractor-1', confirmation);
    expect(readClientOnboardingDraft('contractor-2')).toBeNull();

    const other = { ...confirmation, clientId: 'client-2' };
    saveClientOnboardingDraft('contractor-2', other);
    clearClientOnboardingDraft('contractor-1');

    expect(readClientOnboardingDraft('contractor-1')).toBeNull();
    expect(readClientOnboardingDraft('contractor-2')).toEqual(other);
  });

  it('persists only the approved resumable fields', () => {
    saveClientOnboardingDraft('contractor-1', {
      ...confirmation,
      password: 'must-not-persist',
      access_token: 'must-not-persist',
      refresh_token: 'must-not-persist',
    } as ClientOnboardingDraft);

    const raw = storage.getItem(storage.key(0)!)!;
    expect(raw).not.toMatch(/password|token|must-not-persist/);
    expect(readClientOnboardingDraft('contractor-1')).toEqual(confirmation);
  });

  it('whitelists restored fields too', () => {
    saveClientOnboardingDraft('contractor-1', confirmation);
    storage.setItem(storage.key(0)!, JSON.stringify({
      version: 1,
      draft: { ...confirmation, password: 'ignore', token: 'ignore' },
    }));
    expect(readClientOnboardingDraft('contractor-1')).toEqual(confirmation);
  });

  it.each([
    'not JSON',
    'null',
    '[]',
    JSON.stringify({ version: 2, draft: confirmation }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, draft: { ...confirmation, phase: 'unknown' } }),
    JSON.stringify({ version: 1, draft: { ...confirmation, clientId: null } }),
    JSON.stringify({ version: 1, draft: { ...confirmation, clientId: '  ' } }),
    JSON.stringify({ version: 1, draft: { ...confirmation, phase: 'details' } }),
    JSON.stringify({ version: 1, draft: { ...confirmation, fullName: 123 } }),
    JSON.stringify({ version: 1, draft: { ...confirmation, email: null } }),
  ])('ignores corrupt or unsupported snapshots: %s', (raw) => {
    saveClientOnboardingDraft('contractor-1', confirmation);
    storage.setItem(storage.key(0)!, raw);
    expect(readClientOnboardingDraft('contractor-1')).toBeNull();
  });

  it('does not save invalid phases or inconsistent client IDs', () => {
    saveClientOnboardingDraft('contractor-1', { ...confirmation, clientId: null });
    saveClientOnboardingDraft('contractor-1', { ...confirmation, phase: 'details' });
    expect(storage.length).toBe(0);
  });

  it('does not create or read drafts for an empty contractor ID', () => {
    saveClientOnboardingDraft(' ', confirmation);
    expect(readClientOnboardingDraft(' ')).toBeNull();
    expect(() => clearClientOnboardingDraft(' ')).not.toThrow();
    expect(storage.length).toBe(0);
  });

  it('works without browser globals during server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(readClientOnboardingDraft('contractor-1')).toBeNull();
    expect(() => saveClientOnboardingDraft('contractor-1', confirmation)).not.toThrow();
    expect(() => clearClientOnboardingDraft('contractor-1')).not.toThrow();
  });

  it('ignores browsers that block access to session storage', () => {
    vi.stubGlobal('window', {
      get sessionStorage() { throw new Error('Access denied'); },
    });
    expect(readClientOnboardingDraft('contractor-1')).toBeNull();
    expect(() => saveClientOnboardingDraft('contractor-1', confirmation)).not.toThrow();
    expect(() => clearClientOnboardingDraft('contractor-1')).not.toThrow();
  });

  it('ignores storage operation failures, including quota errors', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => { throw new Error('Read blocked'); },
        setItem: () => { throw new Error('Quota exceeded'); },
        removeItem: () => { throw new Error('Write blocked'); },
      },
    });
    expect(readClientOnboardingDraft('contractor-1')).toBeNull();
    expect(() => saveClientOnboardingDraft('contractor-1', confirmation)).not.toThrow();
    expect(() => clearClientOnboardingDraft('contractor-1')).not.toThrow();
  });

  it('scopes wizard draft keys by both contractor and client without delimiter collisions', () => {
    expect(clientProjectDraftKey('contractor-1', 'client-1')).not.toBe(clientProjectDraftKey('contractor-2', 'client-1'));
    expect(clientProjectDraftKey('contractor-1', 'client-1')).not.toBe(clientProjectDraftKey('contractor-1', 'client-2'));
    expect(clientProjectDraftKey('contractor:a', 'b')).not.toBe(clientProjectDraftKey('contractor', 'a:b'));
    expect(clientProjectDraftKey('contractor/a', 'client:b')).toContain('contractor%2Fa:client%3Ab');
  });
});
