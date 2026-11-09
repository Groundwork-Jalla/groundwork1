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

/** Space the bubble needs. Below the anchor by default; above when there isn't room. */
const BUBBLE_HEIGHT = 150;
const GAP = 12;

export function TourGuide({ tour }: { tour: TourId }) {
  const t = useT();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const steps = stepsFor(tour);

  const [seen, setSeen] = useState<string[]>(() => readSeen(user?.id, tour));
  const [step, setStep] = useState<TourStep | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const frame = useRef<number | null>(null);

  // A different person signing in on the same browser has not seen this one's tour.
  useEffect(() => { setSeen(readSeen(user?.id, tour)); }, [user?.id, tour]);

  const findAnchor = useCallback(
    (anchor: string) => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`),
    [],
  );

  /**
   * Pick the step and measure its anchor.
   *
   * Runs in a layout effect and then again on a frame, because on the render where a
   * route first paints the anchor exists but its box is frequently still zero — an
   * image has not loaded, a font has not swapped, a `motion` entrance is at its initial
   * transform. Measuring once on that frame pins the arrow to the wrong place for as
   * long as the tip is open.
   */
  useLayoutEffect(() => {
    if (!user?.id || tourComplete(steps, seen)) { setStep(null); setBox(null); return; }

    const measure = () => {
      const found = nextStep(steps, seen, { path: pathname, hasProject: true },
        anchor => findAnchor(anchor) != null);
      setStep(found);
      if (!found) { setBox(null); return; }
      const el = findAnchor(found.anchor);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      // A collapsed box means it is not laid out yet, not that it is not there.
      setBox(r.width === 0 && r.height === 0
        ? null
        : { top: r.top, left: r.left, width: r.width, height: r.height });
    };

    measure();
    frame.current = requestAnimationFrame(measure);
    return () => { if (frame.current != null) cancelAnimationFrame(frame.current); };
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

  if (!step || !box || !user?.id) return null;

  const advance = () => setSeen(markSeen(user.id, tour, step.anchor));
  const skip = () => setSeen(dismissTour(user.id, tour, steps.map(s => s.anchor)));

  // Below the anchor unless the bottom of the viewport is nearer than the bubble is tall.
  const side: Side = box.top + box.height + GAP + BUBBLE_HEIGHT > window.innerHeight
    ? 'above' : 'below';

  // Clamped to a 16px gutter so the bubble never hangs off the edge on a phone, which is
  // where most of this market reads the product.
  const width = Math.min(320, window.innerWidth - 32);
  const left = Math.max(16, Math.min(
    box.left + box.width / 2 - width / 2, window.innerWidth - width - 16));
  const top = side === 'below'
    ? box.top + box.height + GAP
    : Math.max(16, box.top - GAP - BUBBLE_HEIGHT);

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
        role="dialog"
        aria-live="polite"
        aria-label={t(step.titleKey)}
        className="fixed z-[91] rounded-2xl border border-brand-border-grey bg-white p-4 shadow-lg dark:border-[#2a2a2a] dark:bg-[#1a1a1a]"
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
