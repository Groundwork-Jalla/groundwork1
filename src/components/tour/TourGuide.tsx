import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { nextStep, stepsFor, tourComplete, type TourId, type TourStep } from '@/lib/tour/steps';
import { dismissTour, markSeen, readSeen } from '@/lib/tour/seen';

// =========================================================
// "Where do I click?"
//
// A ring around the thing to press, an arrow at it, and one sentence saying why. Shown
// on the screen the person is already looking at, which is the whole difference between
// this and the walkthrough videos: a video explains the product once, in advance; this
// answers the question at the moment somebody actually has it.
//
// ── Why a portal and fixed positioning ──────────────────────────────────────────────
// The anchor can be anywhere — inside a scrolling panel, inside a card with
// `overflow: hidden`, inside a stacking context that would clip or re-layer an
// absolutely positioned child. Rendering to `document.body` at viewport coordinates read
// from `getBoundingClientRect()` is the only placement that cannot be clipped by
// whatever the anchor happens to live inside.
//
// ── Why it never blocks ─────────────────────────────────────────────────────────────
// There is no overlay over the page and nothing is modal. The person can ignore the tip
// entirely and press the button it is pointing at — which is, after all, what it is
// asking them to do. A tour that insists on being acknowledged before the app will
// respond is a tour that gets dismissed unread.
// =========================================================

/** Where the bubble sits relative to the anchor, decided by which way there is room. */
type Side = 'above' | 'below';

interface Box { top: number; left: number; width: number; height: number }

/**
 * How tall the bubble is ASSUMED to be, for the very first frame only.
 *
 * It is then measured, because the assumption is wrong by a factor of two: the longest
 * tip — the plan question, which has to explain both ways a project can start — renders
 * near 300px in English and taller in French, where the same sentence runs about 15%
 * longer. A guessed 150 put it half off the bottom of a phone.
 */
const BUBBLE_GUESS = 180;
const GAP = 12;
/** Never closer than this to any edge, on any screen. */
const GUTTER = 16;

export function TourGuide({ tour }: { tour: TourId }) {
  const t = useT();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const steps = stepsFor(tour);

  const [seen, setSeen] = useState<string[]>(() => readSeen(user?.id, tour));
  const [step, setStep] = useState<TourStep | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const frame = useRef<number | null>(null);
  // The bubble's real height, measured once it has rendered. Until then the guess above
  // is used, which only ever affects the first frame of a tip appearing.
  const bubble = useRef<HTMLDivElement | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(BUBBLE_GUESS);

  // A different person signing in on the same browser has not seen this one's tour.
  useEffect(() => { setSeen(readSeen(user?.id, tour)); }, [user?.id, tour]);

  const findAnchor = useCallback(
    (anchor: string) => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`),
    [],
  );

  /**
   * Pick the step and measure its anchor.
   *
   * ── Why this watches the DOM instead of just re-running on navigation ─────────────
   * The anchor frequently appears LATER, with nothing this effect depends on having
   * changed. The project wizard is the case that caught it: every one of its nine steps
   * is the same route, so the plan question mounts while `pathname`, `seen` and the
   * step list all stay exactly as they were. Measured once on arrival, the tour saw no
   * anchor, concluded there was nothing to say, and never looked again — the tip for
   * the single most important question in the product silently never appeared.
   *
   * So the page is observed rather than sampled. The work is cheap: on most mutations
   * `nextStep` finds the same step and the state setters bail out on identical values.
   *
   * ── And why a frame as well ──────────────────────────────────────────────────────
   * On the render where an anchor first paints it exists but its box is often still
   * zero — a font has not swapped, a `motion` entrance is at its initial transform.
   * Measuring only on that frame pins the arrow to the wrong place for as long as the
   * tip is open.
   */
  useLayoutEffect(() => {
    if (!user?.id || tourComplete(steps, seen)) { setStep(null); setBox(null); return; }

    const measure = () => {
      const found = nextStep(steps, seen, { path: pathname, hasProject: true },
        anchor => findAnchor(anchor) != null);
      setStep(prev => (prev?.anchor === found?.anchor ? prev : found));
      if (!found) { setBox(null); return; }
      const el = findAnchor(found.anchor);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      // A collapsed box means it is not laid out yet, not that it is not there.
      if (r.width === 0 && r.height === 0) { setBox(null); return; }
      setBox(prev => (prev
        && prev.top === r.top && prev.left === r.left
        && prev.width === r.width && prev.height === r.height)
        ? prev
        : { top: r.top, left: r.left, width: r.width, height: r.height });
    };

    // Coalesced to one measurement per frame: a React render can fire hundreds of
    // mutation records, and each one would otherwise be a full layout read.
    const schedule = () => {
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => { frame.current = null; measure(); });
    };

    measure();
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    };
  }, [pathname, seen, steps, user?.id, findAnchor]);

  // The anchor moves when the page scrolls or the window changes shape, and the tip has
  // to move with it. `capture` so a scrolling panel's own scroll is heard too, and
  // passive because nothing here prevents the scroll.
  useEffect(() => {
    if (!step) return;
    const reposition = () => {
      const el = findAnchor(step.anchor);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition, { passive: true });
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [step, findAnchor]);

  // Measured after paint, every time the tip changes: the same step is a different
  // height in French, and a language toggle does not remount this.
  useLayoutEffect(() => {
    const h = bubble.current?.offsetHeight;
    if (h && h !== bubbleHeight) setBubbleHeight(h);
  });

  if (!step || !box || !user?.id) return null;

  const advance = () => setSeen(markSeen(user.id, tour, step.anchor));
  const skip = () => setSeen(dismissTour(user.id, tour, steps.map(s => s.anchor)));

  // Below the anchor, unless there is more room above it. Compared both ways rather
  // than only testing "does it fit below": on a phone a long tip fits in NEITHER
  // direction, and the right answer then is the side with more space, not the default.
  const roomBelow = window.innerHeight - (box.top + box.height) - GAP - GUTTER;
  const roomAbove = box.top - GAP - GUTTER;
  const side: Side = bubbleHeight <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';

  // Clamped to a gutter on every edge so the bubble never hangs off the screen, which is
  // where most of this market reads the product.
  const width = Math.min(320, window.innerWidth - GUTTER * 2);
  const left = Math.max(GUTTER, Math.min(
    box.left + box.width / 2 - width / 2, window.innerWidth - width - GUTTER));
  const unclamped = side === 'below'
    ? box.top + box.height + GAP
    : box.top - GAP - bubbleHeight;
  // The last resort: a tip taller than the viewport is pinned to the top gutter and
  // scrolls with its own content rather than being cut off at the bottom.
  const top = Math.max(GUTTER,
    Math.min(unclamped, window.innerHeight - bubbleHeight - GUTTER));

  const Arrow = side === 'below' ? ArrowUp : ArrowDown;
  const remaining = steps.filter(s => !seen.includes(s.anchor)).length;

  return createPortal(
    <>
      {/*
        * The ring. `pointer-events-none` is not decoration: the thing it surrounds is
        * the thing we are asking the person to press, and a ring that swallowed the
        * click would make the tip the obstacle it is meant to remove.
        */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[90] rounded-xl ring-2 ring-brand-near-black ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-[#121212]"
        style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
      />
      <div
        ref={bubble}
        role="dialog"
        aria-live="polite"
        aria-label={t(step.titleKey)}
        className="fixed z-[91] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-brand-border-grey bg-white p-4 shadow-lg dark:border-[#2a2a2a] dark:bg-[#1a1a1a]"
        style={{ top, left, width }}
      >
        <div className="flex items-start gap-2.5">
          <Arrow className="mt-0.5 size-4 shrink-0 text-brand-near-black dark:text-white" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t(step.titleKey)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
              {t(step.bodyKey)}
            </p>
          </div>
          <button
            type="button" onClick={skip} aria-label={t('tour.skip')}
            className="-m-1 shrink-0 rounded-lg p-1 text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button" onClick={skip}
            className="text-[11px] font-medium text-brand-mid-grey underline underline-offset-2 transition-colors hover:text-brand-near-black dark:hover:text-white"
          >
            {t('tour.skip')}
          </button>
          <button
            type="button" onClick={advance}
            className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-black"
          >
            {remaining > 1 ? t('tour.next') : t('tour.done')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
