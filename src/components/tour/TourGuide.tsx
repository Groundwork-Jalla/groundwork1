import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { createPortal } from 'react-dom';
import {
  ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, X,
} from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { nextStep, stepsFor, tourComplete, type TourId, type TourStep } from '@/lib/tour/steps';
import { readTourCompletion,completedTourSteps } from '@/lib/tour/completion';
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
type Side = 'above' | 'below' | 'left' | 'right' | 'docked';

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

/** Does this element itself carry visible words — not merely contain something that does? */
function holdsText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0) return true;
  }
  return false;
}

export function TourGuide({ tour }: { tour: TourId }) {
  const t = useT();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const steps = stepsFor(tour);

  const [seen, setSeen] = useState<string[]>(() => readSeen(user?.id, tour));
  const [completed,setCompleted]=useState<{user:string;project:string;anchors:string[]}|null>(null);
  const projectMatch=/^\/(?:work\/)?projects\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  const projectId=projectMatch?.[1]??'';
  const effectiveSeen=completedTourSteps(seen,completed&&completed.user===user?.id&&completed.project===projectId?completed.anchors:[]);
  useEffect(()=>{if(!user?.id)return;let live=true;let request=0;const uid=user.id;const refresh=()=>{const version=++request;void readTourCompletion(projectId||undefined).then(anchors=>{if(live&&version===request)setCompleted({user:uid,project:projectId,anchors});}).catch(()=>{});};refresh();const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);window.addEventListener('groundwork:project-action',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('groundwork:project-action',refresh);};},[user?.id,projectId,pathname]);
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
    if (!user?.id || tourComplete(steps, effectiveSeen)) { setStep(null); setBox(null); return; }

    const measure = () => {
      const found = nextStep(steps, effectiveSeen, { path: pathname, hasProject: true },
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
    // Permission reads can add/remove the Team invitation cue on an existing
    // tab button. Observe that attribute without watching animated styles/classes.
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour'],
    });
    return () => {
      observer.disconnect();
      if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    };
  }, [pathname, seen, completed, steps, user?.id, findAnchor]);

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

  /*
   * If the sheet still covers the anchor on a phone — an anchor taller than the space
   * either edge leaves — scroll the page by exactly the shortfall, once per step. Once,
   * so it never fights a person who then scrolls back; and only on a phone, because on
   * a wide screen the bubble sits beside the anchor and never over it.
   */
  const nudgedFor = useRef<string | null>(null);
  const placed = useRef<{ top: number } | null>(null);
  useLayoutEffect(() => {
    if (!step || !box || window.innerWidth >= 640 || !placed.current) return;
    if (nudgedFor.current === step.anchor) return;
    const sheetTop = placed.current.top;
    const sheetBottom = sheetTop + bubbleHeight;
    const overlaps = !(box.top >= sheetBottom + GAP || box.top + box.height <= sheetTop - GAP);
    if (!overlaps) return;
    nudgedFor.current = step.anchor;
    // Sheet at the top → bring the anchor down below it; sheet at the bottom → up above it.
    const delta = sheetTop === GUTTER
      ? -(sheetBottom + GAP - box.top)
      : (box.top + box.height) - (sheetTop - GAP);
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }, [step, box, bubbleHeight]);

  if (!step || !box || !user?.id) return null;

  const advance = () => setSeen(markSeen(user.id, tour, step.anchor));
  const skip = () => setSeen(dismissTour(user.id, tour, steps.map(s => s.anchor)));

  /*
   * ── WHERE THE TIP GOES: ON WHATEVER IS NOT TEXT ────────────────────────────────────
   *
   * Favour, 11 Nov 2026: the tip must not sit "on top of something that they need to
   * read." Philip the day before: "the popup blocks critical content." A rule like
   * "below the anchor, else above" cannot promise that, because it never looks at what
   * is underneath. So this looks.
   *
   * Every candidate position is scored by sampling a grid of points inside it and
   * asking the document what is there. A point on an element that holds text costs
   * one; a point on the anchor itself costs ten, because covering the thing we are
   * pointing at is the one failure worse than covering prose. The cheapest candidate
   * wins; ties go to the conventional order, below first. On a wide screen the
   * candidates are the four sides of the anchor; on a phone, where a bubble beside a
   * 320px-wide anchor has nowhere to be, they are the top and bottom edges of the
   * screen — and if even the cheaper edge collides, the page is nudged once (above).
   *
   * The arrow is drawn only when the tip is actually beside its anchor; a sheet pinned
   * to a screen edge would point at nothing.
   */
  const phone = window.innerWidth < 640;
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = phone ? vw - GUTTER * 2 : Math.min(320, vw - GUTTER * 2);
  const clampTop  = (t: number) => Math.max(GUTTER, Math.min(t, vh - bubbleHeight - GUTTER));
  const clampLeft = (l: number) => Math.max(GUTTER, Math.min(l, vw - width - GUTTER));
  const centredLeft = clampLeft(box.left + box.width / 2 - width / 2);

  type Candidate = { side: Side; top: number; left: number };
  const candidates: Candidate[] = phone
    ? [
        { side: 'below', top: clampTop(vh - bubbleHeight - GUTTER), left: GUTTER },
        { side: 'above', top: GUTTER, left: GUTTER },
      ]
    : [
        { side: 'below', top: clampTop(box.top + box.height + GAP), left: centredLeft },
        { side: 'above', top: clampTop(box.top - GAP - bubbleHeight), left: centredLeft },
        { side: 'right', top: clampTop(box.top), left: clampLeft(box.left + box.width + GAP) },
        { side: 'left',  top: clampTop(box.top), left: clampLeft(box.left - GAP - width) },
        /*
         * Docked to a lower corner, pointing at nothing: the ring alone says where to
         * look. On a dense dashboard every side of the anchor can touch text — on /work
         * the four sides of "New project" scored 6, 10+, 10+ and 6 — while the lower
         * half of the page is empty. Listed last so that, costs being equal, a position
         * beside the anchor still wins.
         */
        { side: 'docked', top: clampTop(vh - bubbleHeight - GUTTER), left: clampLeft(vw - width - GUTTER) },
        { side: 'docked', top: clampTop(vh - bubbleHeight - GUTTER), left: GUTTER },
      ];

  const cost = (c: Candidate): number => {
    let total = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const x = c.left + (width * (i + 0.5)) / 5;
        const y = c.top + (bubbleHeight * (j + 0.5)) / 4;
        const onAnchor = x >= box.left && x <= box.left + box.width
                      && y >= box.top && y <= box.top + box.height;
        if (onAnchor) { total += 10; continue; }
        const el = document.elementFromPoint(x, y);
        if (!el || bubble.current?.contains(el)) continue;
        // Text is what a person has to read. Only an element that DIRECTLY holds a
        // text node counts: a wrapper whose descendants hold text is, at this point,
        // padding or background — the first version counted those and found "text"
        // under every candidate on a dense dashboard, so it could never choose.
        if (holdsText(el)) total += 1;
      }
    }
    return total;
  };
  const chosen = candidates.reduce((best, c) => (cost(c) < cost(best) ? c : best), candidates[0]);
  const side: Side = chosen.side;
  const top = chosen.top;
  const left = chosen.left;
  placed.current = { top };
  const beside = !phone && side !== 'docked';

  /*
   * Where the ringed control is, in words, for a tip that is not beside it.
   *
   * Favour, 11 Nov 2026: "as a new user that just signed up, I don't even know where the
   * New project button is." A docked tip saying "click here" points at nothing. So when
   * the tip is away from its target it says which part of the screen to look at —
   * worked out from where the ring actually is, in thirds of the viewport, so it stays
   * true when a layout moves the button.
   */
  const cx = (box.left + box.width / 2) / vw;
  const cy = (box.top + box.height / 2) / vh;
  const vert = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : '';
  const horiz = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : '';
  const where = (vert && horiz ? `${vert}${horiz[0].toUpperCase()}${horiz.slice(1)}`
    : vert || horiz || 'centre') as 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
    | 'top' | 'bottom' | 'left' | 'right' | 'centre';
  const Locator = where === 'topLeft' ? ArrowUpLeft : where === 'topRight' ? ArrowUpRight
    : where === 'bottomLeft' ? ArrowDownLeft : where === 'bottomRight' ? ArrowDownRight
    : where === 'top' ? ArrowUp : where === 'bottom' ? ArrowDown
    : where === 'left' ? ArrowLeft : where === 'right' ? ArrowRight : null;

  const Arrow = side === 'below' ? ArrowUp : side === 'above' ? ArrowDown
    : side === 'right' ? ArrowLeft : ArrowRight;
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
        className={cn(
          'pointer-events-none fixed z-[90] rounded-xl ring-2 ring-brand-near-black ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-[#121212]',
          // Away from its tip, the ring has to be found: it pulses, unless motion is reduced.
          !beside && 'animate-pulse motion-reduce:animate-none',
        )}
        style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
      />
      <div
        ref={bubble}
        role="dialog"
        aria-live="polite"
        aria-label={t(step.titleKey)}
        className="fixed z-[91] max-h-[45vh] overflow-y-auto rounded-2xl border border-brand-border-grey bg-white p-4 shadow-lg sm:max-h-[calc(100vh-32px)] dark:border-[#2a2a2a] dark:bg-[#1a1a1a]"
        style={{ top, left, width }}
      >
        <div className="flex items-start gap-2.5">
          {beside && <Arrow className="mt-0.5 size-4 shrink-0 text-brand-near-black dark:text-white" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t(step.titleKey)}
            </p>
            {!beside && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-brand-near-black dark:text-white">
                {Locator && <Locator className="size-3.5 shrink-0" aria-hidden />}
                {t('tour.look', { where: t(`tour.where.${where}` as TKey) })}
              </p>
            )}
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
            // In dark mode the button is white on black. A plain `hover:bg-black` still
            // fires there, so on hover the text (black) sat on a black background and
            // the label vanished — Favour, 11 Nov 2026. The dark hover is its own rule.
            className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-black dark:hover:bg-brand-off-white dark:hover:text-black"
          >
            {remaining > 1 ? t('tour.next') : t('tour.done')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
