import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_DEFAULT_DATA, type WizardFormData } from '@/types/project';
import type { OnBehalfOf } from '@/contexts/WizardContext';
import type { WizardConfirmationDraft } from './wizard-draft';

const h = vi.hoisted(() => ({
  step: 9,
  direction: 'forward',
  data: {} as WizardFormData,
  onBehalfOf: null as OnBehalfOf | null,
  confirmationDraft: null as WizardConfirmationDraft | null,
  submit: null as (() => Promise<void>) | null,
  createProject: vi.fn(),
  takeProject: vi.fn(),
  startTracking: vi.fn(),
  checkout: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/contexts/WizardContext', () => ({
  WizardProvider: ({ children }: { children: ReactNode }) => children,
  useWizard: () => ({
    step: h.step, direction: h.direction, goTo: vi.fn(),
    data: h.data, onBehalfOf: h.onBehalfOf, reset: vi.fn(), clearDraft: vi.fn(),
    constructionRate: null, cityRate: null,
    ...(h.confirmationDraft ? { confirmationDraft: h.confirmationDraft } : {}),
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'contractor-id' } }) }));
vi.mock('react-router', () => ({
  Link: () => null, useNavigate: () => h.navigate, useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string) => key,
  useFormat: () => ({ money: (value: number) => String(value) }),
}));
vi.mock('@/lib/supabase/admin-users', () => ({ listAdminUsers: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'contractor-id' } } } }) } },
}));
vi.mock('@/lib/supabase/projects', () => ({ createProject: h.createProject }));
vi.mock('@/lib/supabase/contractor-clients', () => ({ takeOwnClientProject: h.takeProject }));
vi.mock('@/lib/supabase/tracking', () => ({
  startProjectTracking: vi.fn(), adminStartProjectTracking: h.startTracking, adminStartProjectAtStage: vi.fn(),
}));
vi.mock('@/lib/supabase/documents', () => ({ uploadDocument: vi.fn() }));
vi.mock('@/lib/payments/subscription', () => ({ startJallaVerifyCheckout: h.checkout }));
vi.mock('@/lib/budget', () => ({
  calculateBudget: () => ({ total: 1000, construction: 1000 }),
  decomposeBudget: () => ({ total: 1000, construction: 1000 }),
}));
vi.mock('@/components/wizard/WizardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, onClick, disabled }: {
      children: ReactNode; onClick: () => Promise<void>; disabled?: boolean;
    }) => {
      h.submit = onClick;
      return createElement('button', { disabled }, children);
    },
  },
}));
// The architecture-plan question now sits between step 1 and step 2. This file is
// about which STEP the wizard routes to — the question has its own tests — so it is
// passed through. Without this the gate renders here and hits `motion.div`, which the
// framer-motion mock above does not define.
vi.mock('@/components/wizard/PlanQuestionStep', () => ({
  PlanQuestionStep: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/wizard/steps/Step1Country', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step2ProjectType', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step3BuildingType', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step4Floors', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step5Rooms', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step7RoofType', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step8Details', () => ({ default: () => null }));
vi.mock('@/components/wizard/steps/Step9Summary', () => ({ default: () => 'project-summary' }));

import { ManagedWizard } from '@/app/routes/admin/projects.new';

describe('contractor client project wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.step = 9;
    h.direction = 'forward';
    h.data = { ...WIZARD_DEFAULT_DATA, projectName: 'Client home' };
    h.onBehalfOf = { userId: 'client-id', label: 'Client', tier: 'self_verify', by: 'partner' };
    h.submit = null;
    h.confirmationDraft = null;
    h.createProject.mockResolvedValue({ id: 'project-id', name: 'Client home' });
  });

  it('renders budget confirmation for the fixed Self Verify project', () => {
    const html = renderToStaticMarkup(createElement(ManagedWizard));
    expect(html).toContain('wizard.confirmBudget.title');
    expect(h.submit).toBeTypeOf('function');
  });

  it('preserves fixed Management behavior for admin-created projects', () => {
    h.onBehalfOf = { userId: 'client-id', label: 'Client', tier: 'jalla_management', by: 'admin' };
    const html = renderToStaticMarkup(createElement(ManagedWizard));
    expect(html).toContain('wizard.confirmBudget.title');
    expect(h.submit).toBeTypeOf('function');
  });

  it('restores the confirmed budget and joining answers and requests the missing attachment', () => {
    h.confirmationDraft = {
      raw: '45000', alreadyStarted: true, described: 'Roof is complete', stageOverride: 6, hadAttachment: true,
    };
    const html = renderToStaticMarkup(createElement(ManagedWizard));
    // Budget confirmation now lives on the project-at-a-glance summary step.
    expect(html).not.toContain('id="final-budget"');
    // No "this project has already started" checkbox any more — picking a stage IS
    // saying it has started, and asking both was asking twice (29 October).
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
    // The STAGE is what is restored now. The free-text description is gone: the stage
    // is chosen from our own list rather than typed and read back out of a sentence,
    // because that answer decides which stages count as already built.
    expect(html).toContain('value="6" selected=""');
    expect(html).not.toContain('value="Roof is complete"');
    expect(html).toContain('wizard.confirmBudget.reattachFile');
  });

  it.each(['', 'jalla_verify', 'jalla_management'] as const)(
    'creates Self Verify for the client even if form tier is %s', async tier => {
      h.data.tier = tier;
      renderToStaticMarkup(createElement(ManagedWizard));
      expect(h.submit).toBeTypeOf('function');
      await h.submit!();
      expect(h.createProject).toHaveBeenCalledWith(
        'client-id', h.data, expect.any(Object), { tier: 'self_verify' },
      );
      expect(h.takeProject).toHaveBeenCalledWith('project-id');
      expect(h.startTracking).toHaveBeenCalledWith(
        'project-id', expect.any(Object), 'client-id', 'Client home',
      );
      expect(h.checkout).not.toHaveBeenCalled();
      // The project itself, not the list (29 October).
      expect(h.navigate).toHaveBeenCalledWith('/work/projects/project-id');
    },
  );
});
