import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnBehalfOf } from '@/contexts/WizardContext';
import type { ProjectTier } from '@/types/project';

const h = vi.hoisted(() => ({
  onBehalfOf: null as OnBehalfOf | null,
  selectedTier: '' as ProjectTier | '',
}));

vi.mock('@/contexts/WizardContext', () => ({
  useWizard: () => ({
    data: { tier: h.selectedTier },
    onBehalfOf: h.onBehalfOf,
    update: vi.fn(), reset: vi.fn(), next: vi.fn(),
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'contractor-id' } }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../WizardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/lib/supabase/projects', () => ({ createProject: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));

import Step10PlanSelection from './Step10PlanSelection';

function planButtons() {
  const html = renderToStaticMarkup(createElement(Step10PlanSelection));
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, body]) => ({
    disabled: /\bdisabled=""/.test(attrs),
    body,
  }));
}

describe('wizard plan selection', () => {
  beforeEach(() => {
    h.onBehalfOf = null;
    h.selectedTier = '';
  });

  it('keeps only Self Verify enabled for a contractor creating a client project', () => {
    h.onBehalfOf = { userId: 'client-id', label: 'Client', tier: 'self_verify', by: 'partner' };
    h.selectedTier = 'self_verify';
    const plans = planButtons();
    expect(plans).toHaveLength(3);
    expect(plans.map(plan => plan.disabled)).toEqual([false, true, true]);
    expect(plans.find(plan => !plan.disabled)?.body).toContain('tiers.selfVerify');
  });

  it('keeps all three choices enabled when a caller has not fixed the tier', () => {
    h.onBehalfOf = { userId: 'client-id', label: 'Client', tier: null, by: 'partner' };
    const plans = planButtons();
    expect(plans).toHaveLength(3);
    expect(plans.every(plan => !plan.disabled)).toBe(true);
  });

  it('keeps only the fixed Management plan enabled for an admin', () => {
    h.onBehalfOf = { userId: 'client-id', label: 'Client', tier: 'jalla_management', by: 'admin' };
    h.selectedTier = 'jalla_management';
    const plans = planButtons();
    expect(plans).toHaveLength(3);
    expect(plans.map(plan => plan.disabled)).toEqual([true, true, false]);
    expect(plans.find(plan => !plan.disabled)?.body).toContain('tiers.jallaManagement');
  });

  it('keeps all three plans available when a client creates their own project', () => {
    const plans = planButtons();
    expect(plans).toHaveLength(3);
    expect(plans.every(plan => !plan.disabled)).toBe(true);
  });
});
