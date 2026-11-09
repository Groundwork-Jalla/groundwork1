import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// The arrow that says what to do next.
//
// ── Why it exists ───────────────────────────────────────────────────────────────────
// Philip's memo, 9 Nov 2026, priority three: contractors and clients need orienting.
// The recorded sessions say the same thing in a more useful way — people sign up, land
// on a dashboard, and do not know which of the things on it is the thing to do first.
// A video answers that once, before they arrive; this answers it while they are here,
// pointing at the actual button on their actual screen.
//
// ── The ONE thing it is for ─────────────────────────────────────────────────────────
// Getting somebody from "signed up" to "a build set up and a contractor on it". It is
// not a feature tour and it must not become one: every step below is a thing a person
// has to do next, never a thing the product has.
//
// ── Why the steps are data and the matching is pure ─────────────────────────────────
// What a person sees depends on their role, whether they have a build yet, and which
// screen they are on. That is three conditions per step and it decides whether somebody
// is pointed at a button that is not there — so it is a function with tests rather than
// a chain of `&&` inside a component.
//
// ── Anchoring ───────────────────────────────────────────────────────────────────────
// By `data-tour="<anchor>"`, never by CSS class or position. A class is a styling
// decision somebody will change without knowing a tooltip was nailed to it; a
// `data-tour` attribute is only ever there for this, and a step whose anchor has gone
// from the page is skipped rather than drawn into empty space.
// =========================================================

export type TourId = 'client-setup' | 'contractor-setup';

export interface TourStep {
  /** Matches `[data-tour="…"]`. The only contract between a step and the DOM. */
  anchor: string;
  titleKey: TKey;
  bodyKey: TKey;
  /** The route this step belongs on. Matched as a prefix, so `/projects` covers its children. */
  route: string;
}

/** What the app knows about the person when it decides what to point at. */
export interface TourContext {
  /** The path they are on right now. */
  path: string;
  /** Do they have a build yet? Until they do, everything else is premature. */
  hasProject: boolean;
}

/**
 * A client's first few minutes.
 *
 * Deliberately short. Four steps is a person being shown where to start; twelve is a
 * person clicking Skip, and a skipped tour teaches nothing at all.
 */
const CLIENT_STEPS: TourStep[] = [
  {
    anchor: 'new-project',
    route: '/dashboard',
    titleKey: 'tour.client.start.title',
    bodyKey: 'tour.client.start.body',
  },
  {
    // The branch the whole product forks on, explained where the fork is.
    anchor: 'plan-question',
    route: '/projects/new',
    titleKey: 'tour.planQuestion.title',
    bodyKey: 'tour.planQuestion.body',
  },
  {
    anchor: 'invite-contractor',
    route: '/projects',
    titleKey: 'tour.client.invite.title',
    bodyKey: 'tour.client.invite.body',
  },
  {
    anchor: 'stage-list',
    route: '/projects',
    titleKey: 'tour.client.approve.title',
    bodyKey: 'tour.client.approve.body',
  },
];

/**
 * A contractor's first few minutes.
 *
 * A contractor sets a build up FOR somebody, so their first step is the client, not the
 * building — and their last is the one that pays them, which is the step most often
 * missed: the money moves when the client's receipt is confirmed, not when the work is
 * finished.
 */
const CONTRACTOR_STEPS: TourStep[] = [
  {
    anchor: 'add-client',
    route: '/work',
    titleKey: 'tour.contractor.client.title',
    bodyKey: 'tour.contractor.client.body',
  },
  {
    anchor: 'plan-question',
    route: '/projects/new',
    titleKey: 'tour.planQuestion.title',
    bodyKey: 'tour.planQuestion.body',
  },
  {
    anchor: 'upload-evidence',
    route: '/work/projects',
    titleKey: 'tour.contractor.evidence.title',
    bodyKey: 'tour.contractor.evidence.body',
  },
  {
    anchor: 'confirm-payment',
    route: '/work/projects',
    titleKey: 'tour.contractor.payment.title',
    bodyKey: 'tour.contractor.payment.body',
  },
];

export function stepsFor(tour: TourId): TourStep[] {
  return tour === 'contractor-setup' ? CONTRACTOR_STEPS : CLIENT_STEPS;
}

/** Prefix match, on path segments. `/projects` covers `/projects/abc`, never `/projectsfoo`. */
export function onRoute(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

/**
 * The step to show right now, or nothing.
 *
 * `present` is asked, not assumed: a step is only drawn when its anchor is genuinely on
 * the page. The alternative is an arrow pointing at the top-left corner, which is how
 * every tour that has ever annoyed anybody begins.
 *
 * Steps are consumed in order and a step already seen is never shown again, so somebody
 * who reaches the project screen before the tour caught up does not get sent backwards.
 */
export function nextStep(
  steps: TourStep[],
  seen: readonly string[],
  ctx: TourContext,
  present: (anchor: string) => boolean,
): TourStep | null {
  for (const step of steps) {
    if (seen.includes(step.anchor)) continue;
    if (!onRoute(ctx.path, step.route)) continue;
    if (!present(step.anchor)) continue;
    return step;
  }
  return null;
}

/** Done once every step has been seen — or once the person has said no thank you. */
export function tourComplete(steps: TourStep[], seen: readonly string[]): boolean {
  return steps.every(step => seen.includes(step.anchor));
}
