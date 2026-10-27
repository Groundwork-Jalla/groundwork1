import { createElement, type EffectCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { clearWizardDraft, readWizardDraft, writeWizardDraft, type WizardDraft } from './wizard-draft';

type WizardValue = ReturnType<typeof useWizard>;
const h = vi.hoisted(() => ({ effects: [] as EffectCallback[], current: null as WizardValue | null }));

// Run the provider's actual passive-effect callbacks explicitly in this server-render
// harness, so reset can be checked against an autosave queued before it completed.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { h.effects.push(effect); },
}));
vi.mock('@/lib/supabase/construction-rates', () => ({
  getCityRate: async () => null, getConstructionRate: async () => null,
}));

import { WizardProvider, useWizard } from '@/contexts/WizardContext';

let entries: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
const key = 'contractor:actor-a:client-a:wizard';
function draft(): WizardDraft {
  return {
    version: 1, step: 8, direction: 'back',
    data: { ...WIZARD_DEFAULT_DATA, floors: 2, projectName: 'Client home', city: 'Buea', sqm: 120,
      targetStartDate: '2026-11-01', targetEndDate: '2027-02-01',
      floorRooms: [{ floor: 0, bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1, offices: 0 }],
    },
    confirmation: { raw: '45000', alreadyStarted: true, described: 'Roof is complete', stageOverride: 6, hadAttachment: true },
  };
}

beforeEach(() => {
  entries = new Map();
  storage = {
    getItem: vi.fn((name: string) => entries.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { entries.set(name, value); }),
    removeItem: vi.fn((name: string) => { entries.delete(name); }),
  };
  vi.stubGlobal('sessionStorage', storage);
  h.effects = [];
  h.current = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('scoped project wizard drafts', () => {
  it('restores the step, direction, form answers, room breakdown and budget confirmation', () => {
    writeWizardDraft(key, draft());
    expect(readWizardDraft(key)).toEqual(draft());
  });

  it('defaults the target end date for drafts saved before the field existed', () => {
    const old = draft();
    const { targetEndDate: _ignored, ...oldData } = old.data;
    writeWizardDraft(key, { ...old, data: oldData as typeof old.data });
    expect(readWizardDraft(key)?.data.targetEndDate).toBe('');
  });

  it('saves the pending country change without restoring an older selection or step', () => {
    writeWizardDraft(key, draft());
    const changed: WizardDraft = {
      ...draft(), step: 1, direction: 'forward', data: { ...draft().data, country: '' },
    };
    writeWizardDraft(key, changed);
    expect(readWizardDraft(key)).toEqual(changed);
  });

  it('isolates drafts for different contractors and clients', () => {
    writeWizardDraft(key, draft());
    expect(readWizardDraft('contractor:actor-b:client-a:wizard')).toBeNull();
    expect(readWizardDraft('contractor:actor-a:client-b:wizard')).toBeNull();
    const other = { ...draft(), step: 4 };
    writeWizardDraft('contractor:actor-a:client-b:wizard', other);
    clearWizardDraft(key);
    expect(readWizardDraft(key)).toBeNull();
    expect(readWizardDraft('contractor:actor-a:client-b:wizard')).toEqual(other);
  });

  it('whitelists fields at every level and stores only the attachment reminder', () => {
    const value = draft();
    writeWizardDraft(key, {
      ...value, password: 'never-save-this', token: 'never-save-this',
      data: { ...value.data, password: 'never-save-this', access_token: 'never-save-this',
        floorRooms: value.data.floorRooms.map(floor => ({ ...floor, password: 'never-save-this' })),
      },
      confirmation: { ...value.confirmation!, file: { name: 'private-quote.pdf' }, password: 'never-save-this' },
    } as unknown as WizardDraft);
    expect(readWizardDraft(key)).toEqual(value);
    expect(entries.get(key)).not.toContain('never-save-this');
    expect(entries.get(key)).not.toContain('private-quote.pdf');
  });

  it.each([
    '{broken-json',
    JSON.stringify({ ...draft(), version: 2 }),
    JSON.stringify({ ...draft(), step: 12 }),
    JSON.stringify({ ...draft(), direction: 'sideways' }),
    JSON.stringify({ ...draft(), data: { ...draft().data, projectType: 'invalid' } }),
    JSON.stringify({ ...draft(), data: { ...draft().data, country: 'invalid' } }),
    JSON.stringify({ ...draft(), data: { ...draft().data, floors: 0 } }),
    JSON.stringify({ ...draft(), data: { ...draft().data, sqm: null } }),
    JSON.stringify({ ...draft(), data: { ...draft().data, bedrooms: -1 } }),
    JSON.stringify({ ...draft(), data: { ...draft().data, floorRooms: [{ floor: 0, bedrooms: 'three' }] } }),
    JSON.stringify({ ...draft(), confirmation: { ...draft().confirmation, stageOverride: 100 } }),
  ])('ignores malformed saved state', raw => {
    entries.set(key, raw);
    expect(readWizardDraft(key)).toBeNull();
  });

  it('does not touch browser storage without an explicit key', () => {
    writeWizardDraft(undefined, draft());
    expect(readWizardDraft()).toBeNull();
    clearWizardDraft();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps the live flow usable when browser storage is blocked', () => {
    const fail = () => { throw new Error('Storage blocked'); };
    storage.getItem.mockImplementation(fail);
    storage.setItem.mockImplementation(fail);
    storage.removeItem.mockImplementation(fail);
    expect(readWizardDraft(key)).toBeNull();
    expect(() => writeWizardDraft(key, draft())).not.toThrow();
    expect(() => clearWizardDraft(key)).not.toThrow();
  });
});

function Probe() {
  h.current = useWizard();
  return createElement('span', null, `${h.current.step}:${h.current.data.projectName}`);
}
function renderProvider(persistenceKey?: string, onReset?: () => void) {
  return renderToStaticMarkup(createElement(WizardProvider, {
    persistenceKey, onReset,
    onBehalfOf: { userId: 'client-a', label: 'Client', tier: 'self_verify', by: 'partner' },
    children: createElement(Probe),
  }));
}

describe('wizard draft lifecycle', () => {
  it('initialises the actual provider from the saved client draft', () => {
    writeWizardDraft(key, draft());
    expect(renderProvider(key)).toContain('8:Client home');
    expect(h.current?.direction).toBe('back');
    expect(h.current?.data).toEqual(draft().data);
    expect(h.current?.confirmationDraft).toEqual(draft().confirmation);
    expect(h.current?.persistProgress).toBe(true);
    expect(h.current?.onBehalfOf?.userId).toBe('client-a');
  });

  it('keeps the ordinary wizard at its original defaults without a key', () => {
    writeWizardDraft(key, draft());
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    expect(renderProvider()).toContain('1:');
    h.effects.forEach(effect => effect());
    expect(h.current?.data).toEqual(WIZARD_DEFAULT_DATA);
    expect(h.current?.confirmationDraft).toBeUndefined();
    expect(h.current?.updateConfirmationDraft).toBeUndefined();
    expect(h.current?.persistProgress).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('clears completed drafts and the active-client pointer without a queued autosave recreating them', () => {
    writeWizardDraft(key, draft());
    const onReset = vi.fn();
    renderProvider(key, onReset);
    h.effects.forEach(effect => effect());
    expect(readWizardDraft(key)).toEqual(draft());
    h.current!.reset();
    expect(readWizardDraft(key)).toBeNull();
    expect(onReset).toHaveBeenCalledOnce();
    // Even a previously scheduled effect sees the reset marker and leaves storage empty.
    h.effects.forEach(effect => effect());
    expect(readWizardDraft(key)).toBeNull();
    h.effects = [];
    expect(renderProvider(key)).toContain('1:');
  });

  it('falls back to a fresh wizard for invalid saved state', () => {
    entries.set(key, '{broken-json');
    expect(renderProvider(key)).toContain('1:');
    expect(h.current?.data).toEqual(WIZARD_DEFAULT_DATA);
  });
});
