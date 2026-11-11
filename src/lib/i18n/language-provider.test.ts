import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  values: [] as any[], cursor: 0, effects: [] as (() => unknown)[],
  auth: null as ((id: string | null) => void) | null,
  read: vi.fn(), save: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: any) => {
    const slot = harness.cursor++;
    if (!(slot in harness.values)) harness.values[slot] = typeof initial === 'function' ? initial() : initial;
    return [harness.values[slot], (value: any) => {
      harness.values[slot] = typeof value === 'function' ? value(harness.values[slot]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.values)) harness.values[slot] = { current: initial };
    return harness.values[slot];
  },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('./persist-lang', async importOriginal => ({
  ...await importOriginal<typeof import('./persist-lang')>(),
  fetchPreferredLang: harness.read,
  persistPreferredLang: harness.save,
  onAuthUser: (callback: (id: string | null) => void) => {
    harness.auth = callback;
    return () => {};
  },
}));

import { LanguageProvider } from './index';

function render() {
  harness.cursor = 0;
  return LanguageProvider({ children: null }).props.value;
}

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.effects = []; harness.auth = null;
  harness.read.mockReset().mockResolvedValue(null);
  harness.save.mockReset().mockResolvedValue(true);
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('effective UI language follows the account', () => {
  it('saves English for a signed-in user who never touched the toggle', async () => {
    expect(render().lang).toBe('en');
    harness.effects.forEach(effect => effect());
    harness.auth!('person-1');
    await vi.waitFor(() => expect(harness.save).toHaveBeenCalledWith('en'));
  });

  it('keeps the current English choice with blocked storage and a stale French profile', async () => {
    vi.stubGlobal('navigator', { languages: ['fr-CM'] });
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    });
    harness.read.mockResolvedValue('fr');
    const french = render();
    expect(french.lang).toBe('fr');
    harness.effects.forEach(effect => effect());
    french.setLang('en');
    expect(render().lang).toBe('en');
    harness.save.mockClear();
    harness.auth!('person-1');
    await vi.waitFor(() => expect(harness.save).toHaveBeenCalledWith('en'));
    expect(render().lang).toBe('en');
  });

  it('does not overwrite the account language after a failed preference read', async () => {
    harness.read.mockResolvedValue(undefined);
    render();
    harness.effects.forEach(effect => effect());
    harness.auth!('person-1');
    await Promise.resolve();
    expect(harness.save).not.toHaveBeenCalled();
  });
});
