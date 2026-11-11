import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { stepsFor, nextStep, onRoute, tourComplete } from './steps';

const everywhere = () => true;
const nowhere = () => false;

describe('onRoute', () => {
  it('matches the route itself and its children', () => {
    expect(onRoute('/projects', '/projects')).toBe(true);
    expect(onRoute('/projects/abc', '/projects')).toBe(true);
  });

  it('does not match a route that merely starts with the same letters', () => {
    expect(onRoute('/projectsfoo', '/projects')).toBe(false);
  });

  it('does not match a parent from a child route', () => {
    expect(onRoute('/work', '/work/projects')).toBe(false);
  });
});

describe('nextStep', () => {
  const client = stepsFor('client-setup');

  it('points at the first thing to do on the screen they are on', () => {
    const step = nextStep(client, [], { path: '/dashboard', hasProject: false }, everywhere);
    expect(step?.anchor).toBe('new-project');
  });

  it('shows nothing when the anchor is not on the page', () => {
    // The whole reason this is asked rather than assumed: an arrow pointing at a button
    // that is not rendered points at the top-left corner of the screen.
    expect(nextStep(client, [], { path: '/dashboard', hasProject: false }, nowhere)).toBeNull();
  });

  it('shows nothing on a screen none of its steps belong to', () => {
    expect(nextStep(client, [], { path: '/profile', hasProject: true }, everywhere)).toBeNull();
  });

  it('never shows a step twice', () => {
    const step = nextStep(client, ['new-project'], { path: '/dashboard', hasProject: false }, everywhere);
    expect(step).toBeNull();
  });

  it('does not send somebody backwards when they get ahead of it', () => {
    // Straight to the project screen without the dashboard step. The next thing to say
    // is the one for where they ARE, not the one they skipped past.
    const step = nextStep(client, [], { path: '/projects/abc', hasProject: true }, everywhere);
    expect(step?.anchor).toBe('invite-contractor');
  });

  it('asks the plan question where the plan question is', () => {
    const step = nextStep(client, ['new-project'], { path: '/projects/new', hasProject: false }, everywhere);
    expect(step?.anchor).toBe('plan-question');
  });
});

describe('the two tours', () => {
  it('start a contractor on the client, not on the building', () => {
    expect(stepsFor('contractor-setup')[0].anchor).toBe('add-client');
  });

  it('both check the confirmed figure against the bill, on the wizard, after the plan question', () => {
    // Philip, 10 Nov 2026: a walkthrough on the budget confirmation page.
    for (const tour of ['client-setup', 'contractor-setup'] as const) {
      const anchors = stepsFor(tour).map(s => s.anchor);
      expect(anchors).toContain('confirm-budget');
      expect(anchors.indexOf('confirm-budget')).toBeGreaterThan(anchors.indexOf('plan-question'));
      expect(stepsFor(tour).find(s => s.anchor === 'confirm-budget')?.route).toBe('/projects/new');
    }
  });

  it('both explain the plan question, in the same words', () => {
    const client = stepsFor('client-setup').find(s => s.anchor === 'plan-question');
    const contractor = stepsFor('contractor-setup').find(s => s.anchor === 'plan-question');
    expect(client?.bodyKey).toBe(contractor?.bodyKey);
  });

  it('stay short enough to be read', () => {
    // Four steps is an introduction. Twelve is a person pressing Skip, and a skipped
    // tour teaches nothing at all. The wizard cues are counted apart: one per screen,
    // and never two on one screen — see WIZARD_CUES.
    for (const tour of ['client-setup', 'contractor-setup'] as const) {
      const outsideWizard = stepsFor(tour).filter(s => !s.anchor.startsWith('wizard-step-'));
      expect(outsideWizard.length).toBeLessThanOrEqual(5);
    }
  });

  it('give every wizard screen one cue, except the summary, which has the budget check', () => {
    // "For each stage in the project creation, it should tell them" (11 Nov 2026).
    for (const tour of ['client-setup', 'contractor-setup'] as const) {
      const anchors = stepsFor(tour).map(s => s.anchor);
      for (const n of [1, 2, 3, 4, 5, 6, 7, 9]) expect(anchors).toContain(`wizard-step-${n}`);
      expect(anchors).not.toContain('wizard-step-8');
      // In screen order, with the budget check sitting where step 8 is.
      const order = anchors.filter(a => a.startsWith('wizard-step-') || a === 'confirm-budget');
      expect(order).toEqual(['wizard-step-1', 'wizard-step-2', 'wizard-step-3', 'wizard-step-4',
        'wizard-step-5', 'wizard-step-6', 'wizard-step-7', 'confirm-budget', 'wizard-step-9']);
      // And never two cues sharing a screen.
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('give every step an anchor, a route and both pieces of copy', () => {
    for (const tour of ['client-setup', 'contractor-setup'] as const) {
      for (const step of stepsFor(tour)) {
        expect(step.anchor).toBeTruthy();
        expect(step.route.startsWith('/')).toBe(true);
        expect(step.titleKey).toBeTruthy();
        expect(step.bodyKey).toBeTruthy();
      }
    }
  });
});

describe('no tip says "here"', () => {
  /*
   * Favour, 11 Nov 2026: "as a new user that just signed up, I don't even know where the
   * New project button is." A tip can be docked anywhere the text is not, so "here"
   * points at nothing. A tip names the control by its label, and the component adds
   * where on the screen to look whenever it is not beside it.
   */
  it.each(['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts'])('%s', file => {
    const dict = readFileSync(resolve(__dirname, '..', '..', '..', file), 'utf8');
    const tour = dict.slice(dict.indexOf('\n  tour: {'), dict.indexOf('\n  planGate: {'));
    expect(tour).not.toMatch(/click here|cliquez ici|tap here|appuyez ici/i);
  });
});

describe('tourComplete', () => {
  it('is done only once every step has been seen', () => {
    const steps = stepsFor('client-setup');
    expect(tourComplete(steps, steps.map(s => s.anchor))).toBe(true);
    expect(tourComplete(steps, steps.slice(1).map(s => s.anchor))).toBe(false);
  });
});
