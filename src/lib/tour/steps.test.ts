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

  it('both explain the plan question, in the same words', () => {
    const client = stepsFor('client-setup').find(s => s.anchor === 'plan-question');
    const contractor = stepsFor('contractor-setup').find(s => s.anchor === 'plan-question');
    expect(client?.bodyKey).toBe(contractor?.bodyKey);
  });

  it('stay short enough to be read', () => {
    // Four steps is an introduction. Twelve is a person pressing Skip, and a skipped
    // tour teaches nothing at all.
    for (const tour of ['client-setup', 'contractor-setup'] as const) {
      expect(stepsFor(tour).length).toBeLessThanOrEqual(5);
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

describe('tourComplete', () => {
  it('is done only once every step has been seen', () => {
    const steps = stepsFor('client-setup');
    expect(tourComplete(steps, steps.map(s => s.anchor))).toBe(true);
    expect(tourComplete(steps, steps.slice(1).map(s => s.anchor))).toBe(false);
  });
});
