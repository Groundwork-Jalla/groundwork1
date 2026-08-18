import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarClock, Check, ChevronLeft, ClipboardList, Lock } from 'lucide-react';
import { useForceLight } from '@/hooks/useForceLight';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';
import { JALLA_MANAGEMENT_AUDIT_URL, JALLA_MANAGEMENT_FORM_URL } from '@/lib/jalla-management';

// =========================================================
// Jalla Management enquiry — a funnel, not a menu.
//
// The first version showed both links at once with a "skip to step two" note, which
// made the questionnaire optional. It is not: the form is what the audit is prepared
// from, and an enquiry that arrives with a booking and no answers costs someone a
// half-hour of discovery that the form was meant to have already done.
//
// So step two stays locked until step one is done. Neither Google Calendar nor Google
// Forms calls back, so completion is self-attested — the visitor confirms they booked.
// That is a soft gate, deliberately: the alternative is no gate at all, and someone who
// clicks "I've booked my call" without booking has told us something useful anyway.
//
// Progress is kept in localStorage because both steps open in a new tab, and coming
// back to a page that had forgotten where you were would read as the funnel breaking.
// =========================================================

type Stage = 'call' | 'form' | 'done';

const STORAGE_KEY = 'gw_jm_funnel';

function loadStage(): Stage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'call' || raw === 'form' || raw === 'done') return raw;
  } catch { /* private mode */ }
  return 'call';
}

function StepCard({
  n, icon, state, titleKey, bodyKey, ctaKey, confirmKey, doneKey, lockedKey, href, onConfirm,
}: {
  n: number;
  icon: React.ReactNode;
  state: 'locked' | 'active' | 'done';
  titleKey: TKey; bodyKey: TKey; ctaKey: TKey; confirmKey: TKey; doneKey: TKey; lockedKey: TKey;
  href: string;
  onConfirm: () => void;
}) {
  const t = useT();
  // Revealed once they have actually opened the link — asking "did you book?" before
  // they have been sent anywhere is a question with only one honest answer.
  const [opened, setOpened] = useState(false);

  return (
    <div
      className={cn(
        'flex gap-4 rounded-2xl border p-6 transition-colors sm:p-7',
        state === 'locked' ? 'border-brand-border-grey bg-brand-off-white/60' : 'border-brand-near-black',
      )}
      aria-disabled={state === 'locked'}
    >
      <div className="flex flex-col items-center gap-3">
        <span className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums',
          state === 'done'   && 'bg-brand-near-black text-white',
          state === 'active' && 'bg-brand-near-black text-white',
          state === 'locked' && 'border border-brand-border-grey text-brand-border-grey',
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

        {state === 'active' && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black"
            >
              {t(ctaKey)}
              <ArrowRight className="size-3.5" />
            </a>
            {opened && (
              <button
                type="button"
                onClick={onConfirm}
                className="text-sm font-semibold text-brand-near-black underline underline-offset-4 hover:text-black"
              >
                {t(confirmKey)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JallaManagementPage() {
  useForceLight();
  const t = useT();
  const [stage, setStage] = useState<Stage>('call');

  // Client-only: localStorage is not readable during the first render.
  useEffect(() => { setStage(loadStage()); }, []);

  function advance(next: Stage) {
    setStage(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <Link
        to="/pricing"
        className="mb-8 inline-flex items-center gap-1 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black"
      >
        <ChevronLeft className="size-3.5" /> {t('jallaManagement.backToPricing')}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-brand-mid-grey">
          {t('jallaManagement.eyebrow')}
        </p>
        <h1 className="text-3xl font-black leading-tight text-brand-near-black sm:text-4xl">
          {t('jallaManagement.title')}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-brand-mid-grey sm:text-base">
          {t('jallaManagement.body')}
        </p>
      </motion.div>

      {/* Progress. Two steps is few enough that a bar would be noise, but the visitor
          still needs to know the second one exists before they commit to the first. */}
      <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-brand-mid-grey">
        {stage === 'done'
          ? t('jallaManagement.progressDone')
          : t('jallaManagement.progress', { n: stage === 'call' ? 1 : 2 })}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <StepCard
          n={1}
          icon={<CalendarClock className="size-4" />}
          state={stage === 'call' ? 'active' : 'done'}
          titleKey="jallaManagement.step1Title"
          bodyKey="jallaManagement.step1Body"
          ctaKey="jallaManagement.step1Cta"
          confirmKey="jallaManagement.step1Confirm"
          doneKey="jallaManagement.step1Done"
          lockedKey="jallaManagement.step2Locked"
          href={JALLA_MANAGEMENT_AUDIT_URL}
          onConfirm={() => advance('form')}
        />
        <StepCard
          n={2}
          icon={<ClipboardList className="size-4" />}
          state={stage === 'call' ? 'locked' : stage === 'form' ? 'active' : 'done'}
          titleKey="jallaManagement.step2Title"
          bodyKey="jallaManagement.step2Body"
          ctaKey="jallaManagement.step2Cta"
          confirmKey="jallaManagement.step2Confirm"
          doneKey="jallaManagement.step2Done"
          lockedKey="jallaManagement.step2Locked"
          href={JALLA_MANAGEMENT_FORM_URL}
          onConfirm={() => advance('done')}
        />
      </div>

      {stage === 'done' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl bg-brand-near-black px-6 py-7 text-center text-white"
        >
          <p className="text-lg font-bold">{t('jallaManagement.doneTitle')}</p>
          <p className="mt-2 text-sm text-white/70">{t('jallaManagement.doneBody')}</p>
        </motion.div>
      )}
    </div>
  );
}
