import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  clearEmergencyContactDraft, readEmergencyContactDraft, saveEmergencyContactDraft,
} from './emergency-contact-draft';

/**
 * The one place mid-onboarding typing was still lost.
 *
 * The panels already resume: a contractor who signs the agreement, saves their identity
 * and leaves comes back to the licence panel. 116 saves the three emergency contacts in
 * ONE call though, so stopping after the first or second meant retyping them.
 */

/** The same in-memory Storage the sibling draft test uses: these run without a DOM. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: key => { items.delete(key); },
    clear: () => { items.clear(); },
    key: index => [...items.keys()][index] ?? null,
  };
}

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/onboarding.tsx'), 'utf8');

const blank = () => [
  { fullName: '', relationship: '', phone: '' },
  { fullName: '', relationship: '', phone: '' },
  { fullName: '', relationship: '', phone: '' },
];
const partial = () => {
  const c = blank();
  c[0] = { fullName: 'Awa Nkeng', relationship: 'Sister', phone: '+237677112233' };
  return c;
};

let storage: Storage;
beforeEach(() => { storage = memoryStorage(); vi.stubGlobal('window', { localStorage: storage }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('a half-filled set of contacts survives walking away', () => {
  it('round-trips what was typed', () => {
    saveEmergencyContactDraft('user-1', partial());
    expect(readEmergencyContactDraft('user-1')).toEqual(partial());
  });

  it('and is kept per contractor, so another account does not inherit it', () => {
    // Two people signing in on one shared machine is normal on a site office computer.
    saveEmergencyContactDraft('user-1', partial());
    expect(readEmergencyContactDraft('user-2')).toBeNull();
  });

  it('is dropped once the three are saved', () => {
    saveEmergencyContactDraft('user-1', partial());
    clearEmergencyContactDraft('user-1');
    expect(readEmergencyContactDraft('user-1')).toBeNull();
  });

  it('does not store an entirely blank set', () => {
    // Otherwise merely opening the panel would leave a draft behind that restores
    // nothing and only has to be cleaned up.
    saveEmergencyContactDraft('user-1', blank());
    expect(readEmergencyContactDraft('user-1')).toBeNull();
  });

  it('keeps only the three resumable fields', () => {
    const tainted = partial() as unknown as Record<string, unknown>[];
    tainted[0].token = 'should-never-be-stored';
    saveEmergencyContactDraft('user-1', tainted as never);
    const back = readEmergencyContactDraft('user-1');
    expect(back?.[0]).toEqual({ fullName: 'Awa Nkeng', relationship: 'Sister', phone: '+237677112233' });
    expect(storage.getItem('groundwork:emergency-contacts:v1:user-1'))
      .not.toContain('should-never-be-stored');
  });

  it('refuses a stored shape that is not three contacts', () => {
    // The panels index this array by position, so a shorter one would read undefined.
    const key = `groundwork:emergency-contacts:v1:user-1`;
    storage.setItem(key, JSON.stringify({ version: 1, contacts: [partial()[0]] }));
    expect(readEmergencyContactDraft('user-1')).toBeNull();
  });

  it('ignores a draft written by an older version', () => {
    const key = `groundwork:emergency-contacts:v1:user-1`;
    storage.setItem(key, JSON.stringify({ version: 0, contacts: partial() }));
    expect(readEmergencyContactDraft('user-1')).toBeNull();
  });

  it('survives unparseable storage rather than throwing', () => {
    storage.setItem('groundwork:emergency-contacts:v1:user-1', 'not json');
    expect(readEmergencyContactDraft('user-1')).toBeNull();
  });
});

describe('the database stays the record', () => {
  it('saved contacts win over a draft', () => {
    // A draft is only a copy of unsaved typing. If the three are on file, they are the
    // truth and a stale local copy must not overwrite them on screen.
    expect(page).toMatch(/if \(r\.contacts\.length === 3\) \{ setContacts\(r\.contacts\); return; \}/);
  });

  it('and the draft is cleared the moment they persist', () => {
    expect(page).toMatch(/if \(next\.steps\.emergency && user\?\.id\) clearEmergencyContactDraft\(user\.id\)/);
  });

  it('nothing partial is written to the database', () => {
    // 116's rule: exactly three, in one call. The draft exists so that rule can stay.
    expect(page).toMatch(/if \(n < 3\) \{ onNext\(\); return; \}/);
  });
});
