import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarClock, Check, ChevronLeft, ClipboardList, Lock } from 'lucide-react';
import { useForceLight } from '@/hooks/useForceLight';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';
import {
  JALLA_MANAGEMENT_AUDIT_EMBED_URL, JALLA_MANAGEMENT_AUDIT_URL,
  JALLA_MANAGEMENT_FORM_EMBED_URL, JALLA_MANAGEMENT_FORM_URL,
} from '@/lib/jalla-management';

// =========================================================
// Jalla Management enquiry — one page, one tab, two gated steps.
//
// Both Google surfaces are embedded rather than linked, so nobody leaves the funnel to
// complete it. Earlier attempts sent visitors out to a new tab or a popup and tried to
// detect their return; a popup cannot work at all here, because Google Calendar serves
// Cross-Origin-Opener-Policy: same-origin and the window handle reports `closed` the
// instant it navigates — which advanced the funnel before anyone had booked.
//
// Completion is detected from the iframe's `load` event. A cross-origin frame will not
// let us read its contents, but it still tells the parent each time a document loads
// inside it: the first is the booker/form rendering, and a second means Google
// navigated it — a booking confirmation, or the form's "response recorded" page. That
// is the only signal available without a server-side webhook, so a manual control is
// kept alongside it for the case where Google handles a step client-side and never
// reloads the frame.
// =========================================================

type Stage = 'call' | 'booked' | 'form' | 'done';

const STORAGE_KEY = 'gw_jm_funnel';

function loadStage(): Stage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'call' || raw === 'booked' || raw === 'form' || raw === 'done') return raw;
  } catch { /* private mode */ }
  return 'call';
}

/** How long before offering the manual "I've done this" control. */
const MANUAL_FALLBACK_MS = 40_000;

/**
 * An embedded Google surface that reports when it has been navigated.
 *
 * The first `load` is the frame rendering. Any load after that means the visitor did
 * something that moved Google to another page, which for both of our surfaces means
 * they finished.
 */
function EmbeddedStep({ src, titleKey, onComplete }: {
  src: string; titleKey: TKey; onComplete: () => void;
}) {
  const t = useT();
  const loads = useRef(0);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShowManual(true), MANUAL_FALLBACK_MS);
    return () => clearTimeout(id);
  }, []);

  const handleLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current > 1) onComplete();
  }, [onComplete]);

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-xl border border-brand-border-grey bg-white">
        <iframe
          src={src}
          title={t(titleKey)}
          onLoad={handleLoad}
          className="h-[620px] w-full sm:h-[680px]"
          frameBorder={0}
        >
          {t('common.loading')}
        </iframe>
      </div>
      {showManual && (
        <button
          type="button"
          onClick={onComplete}
          className="mt-3 text-sm font-semibold text-brand-near-black underline underline-offset-4 hover:text-black"
        >
          {t('jallaManagement.manualAdvance')}
        </button>
      )}
    </div>
  );
}

function StepShell({ n, icon, state, titleKey, bodyKey, doneKey, lockedKey, children }: {
  n: number;
  icon: React.ReactNode;
  state: 'locked' | 'active' | 'done';
  titleKey: TKey; bodyKey: TKey; doneKey: TKey; lockedKey: TKey;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        'rounded-2xl border p-6 transition-colors sm:p-7',
        state === 'locked' ? 'border-brand-border-grey bg-brand-off-white/60' : 'border-brand-near-black',
      )}
      aria-disabled={state === 'locked'}
    >
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-3">
          <span className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums',
            state === 'locked'
              ? 'border border-brand-border-grey text-brand-border-grey'
              : 'bg-brand-near-black text-white',
          )}>
            {state === 'done' ? <Check className="size-4 stroke-[3]" /> : n}
          </span>
          <span className={state === 'locked' ? 'text-brand-border-grey' : 'text-brand-mid-grey'}>
            {state === 'locked' ? <Lock className="size-4" /> : icon}
          </span>
        </div>

        <div className="flex-1">
          <h2 className={cn('text-base font-bold', state === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black')}>
            {t(titleKey)}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-mid-grey">{t(bodyKey)}</p>

          {state === 'done' && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-near-black">
              <Check className="size-3.5 stroke-[3]" /> {t(doneKey)}
            </p>
          )}
          {state === 'locked' && (
            <p className="mt-4 text-xs font-medium text-brand-mid-grey">{t(lockedKey)}</p>
          )}
        </div>
      </div>

      {/* Full width, outside the icon gutter — the embeds need every pixel. */}
      {children}
    </div>
  );
}

export default function JallaManagementPage() {
  useForceLight();
  const t = useT();
  const [params] = useSearchParams();
  const projectId = params.get('project');
  const [stage, setStage] = useState<Stage>('call');

  useEffect(() => { setStage(loadStage()); }, []);

  const advance = useCallback((next: Stage) => {
    setStage(prev => {
      // Guard against a late `load` event from a frame that is already behind us.
      const order: Stage[] = ['call', 'booked', 'form', 'done'];
      if (order.indexOf(next) <= order.indexOf(prev)) return prev;
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const onBooked  = useCallback(() => advance('booked'), [advance]);
  const onDone    = useCallback(() => advance('done'),   [advance]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <Link
        to={projectId ? `/projects/${projectId}` : '/pricing'}
        className="mb-8 inline-flex items-center gap-1 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black"
      >
        <ChevronLeft className="size-3.5" />
        {projectId ? t('jallaManagement.backToProject') : t('jallaManagement.backToPricing')}
      </Link>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-brand-mid-grey">
          {t('jallaManagement.eyebrow')}
        </p>
        <h1 className="text-3xl font-black leading-tight text-brand-near-black sm:text-4xl">
          {t('jallaManagement.title')}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-brand-mid-grey sm:text-base">
          {projectId ? t('jallaManagement.projectCreated') : t('jallaManagement.body')}
        </p>
      </motion.div>

      <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-brand-mid-grey">
        {stage === 'done'
          ? t('jallaManagement.progressDone')
          : t('jallaManagement.progress', { n: stage === 'call' ? 1 : 2 })}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <StepShell
          n={1}
          icon={<CalendarClock className="size-4" />}
          state={stage === 'call' ? 'active' : 'done'}
          titleKey="jallaManagement.step1Title"
          bodyKey="jallaManagement.step1Body"
          doneKey="jallaManagement.step1Done"
          lockedKey="jallaManagement.step2Locked"
        >
          {stage === 'call' && (
            <EmbeddedStep
              src={JALLA_MANAGEMENT_AUDIT_EMBED_URL}
              titleKey="jallaManagement.step1Title"
              onComplete={onBooked}
            />
          )}
        </StepShell>

        {/* The hand-off. Unlocking silently would leave the visitor looking at a booking
            confirmation with no idea the funnel had moved on. */}
        {stage === 'booked' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-start gap-3 rounded-2xl bg-brand-near-black px-6 py-6 text-white sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-bold">{t('jallaManagement.continueTitle')}</p>
              <p className="mt-1 text-sm text-white/70">{t('jallaManagement.continueBody')}</p>
            </div>
            <button
              type="button"
              onClick={() => advance('form')}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white"
            >
              {t('jallaManagement.continueCta')}
              <ArrowRight className="size-3.5" />
            </button>
          </motion.div>
        )}

        <StepShell
          n={2}
          icon={<ClipboardList className="size-4" />}
          state={stage === 'call' || stage === 'booked' ? 'locked' : stage === 'form' ? 'active' : 'done'}
          titleKey="jallaManagement.step2Title"
          bodyKey="jallaManagement.step2Body"
          doneKey="jallaManagement.step2Done"
          lockedKey="jallaManagement.step2Locked"
        >
          {stage === 'form' && (
            <EmbeddedStep
              src={JALLA_MANAGEMENT_FORM_EMBED_URL}
              titleKey="jallaManagement.step2Title"
              onComplete={onDone}
            />
          )}
        </StepShell>
      </div>

      {stage === 'done' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl bg-brand-near-black px-6 py-7 text-center text-white"
        >
          <p className="text-lg font-bold">{t('jallaManagement.doneTitle')}</p>
          <p className="mt-2 text-sm text-white/70">{t('jallaManagement.doneBody')}</p>
          {projectId && (
            <Link
              to={`/projects/${projectId}`}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white"
            >
              {t('jallaManagement.doneCtaProject')}
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </motion.div>
      )}

      {/* Last resort: a frame that will not render at all still has to be completable. */}
      <p className="mt-8 text-xs leading-relaxed text-brand-mid-grey">
        {t('jallaManagement.frameFallback')}{' '}
        <a href={JALLA_MANAGEMENT_AUDIT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-brand-near-black">
          {t('jallaManagement.step1Cta')}
        </a>
        {' · '}
        <a href={JALLA_MANAGEMENT_FORM_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-brand-near-black">
          {t('jallaManagement.step2Cta')}
        </a>
      </p>
    </div>
  );
}
