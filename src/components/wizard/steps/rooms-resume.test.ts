import { createElement, type EffectCallback, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_DEFAULT_DATA, type WizardFormData } from '@/types/project';

const h = vi.hoisted(() => ({
  data: {} as WizardFormData,
  persistProgress: true,
  update: vi.fn(),
  effects: [] as EffectCallback[],
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { h.effects.push(effect); },
}));
vi.mock('@/contexts/WizardContext', () => ({
  useWizard: () => ({ data: h.data, persistProgress: h.persistProgress, update: h.update, next: vi.fn(), back: vi.fn() }),
}));
vi.mock('../WizardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children: ReactNode }) => children },
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    tPlural: (key: string) => key,
  }),
}));

import Step5Rooms from './Step5Rooms';

function currentFloor() {
  const html = renderToStaticMarkup(createElement(Step5Rooms));
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find(([, attrs]) => attrs.includes('aria-current="step"'));
}

describe('returning to room entry', () => {
  beforeEach(() => {
    h.data = {
      ...WIZARD_DEFAULT_DATA, floors: 3, previewActiveFloor: 2,
      floorRooms: [0, 1, 2].map(floor => ({
        floor, bedrooms: floor < 2 ? 1 : 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0,
      })),
    };
    h.persistProgress = true;
    h.effects = [];
    h.update.mockClear();
  });

  it('restores the upper-floor cursor even when that newly reached floor is empty', () => {
    const selected = currentFloor();
    expect(selected?.[2]).toContain('F2');
    expect(selected?.[1]).not.toContain('disabled=""');
    h.effects.forEach(effect => effect());
    expect(h.update).toHaveBeenLastCalledWith({ previewActiveFloor: 2 });
  });

  it.each([[99, 'F2', 2], [-1, 'GF', 0]] as const)('clamps restored cursor %s to a valid floor', (saved, label, floor) => {
    h.data.previewActiveFloor = saved;
    expect(currentFloor()?.[2]).toContain(label);
    h.effects.forEach(effect => effect());
    expect(h.update).toHaveBeenLastCalledWith({ previewActiveFloor: floor });
  });

  it('preserves ground-floor entry for an ordinary wizard without persistence', () => {
    h.persistProgress = false;
    expect(currentFloor()?.[2]).toContain('GF');
    h.effects.forEach(effect => effect());
    expect(h.update).toHaveBeenLastCalledWith({ previewActiveFloor: 0 });
  });
});
