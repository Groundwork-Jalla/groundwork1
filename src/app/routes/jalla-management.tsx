import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarClock, ClipboardList, ChevronLeft } from 'lucide-react';
import { useForceLight } from '@/hooks/useForceLight';
import { useT, type TKey } from '@/lib/i18n';
import { JALLA_MANAGEMENT_CALL_URL, JALLA_MANAGEMENT_FORM_URL } from '@/lib/jalla-management';

// =========================================================
// Jalla Management enquiry — the two steps, in order.
//
// Both links could have been dropped straight onto the pricing CTA, but only one of
// them can be: a single button goes to a single place. Sequencing them through Google
// Calendar's confirmation screen would put the second half of the flow in a setting
// nobody in this repo can see or test. This page owns the order instead, so the form
// is always reachable whether or not the booking confirmation mentions it.
//
// Light-only like the rest of the public site — see hooks/useForceLight.
// =========================================================

function Step({ n, icon, titleKey, bodyKey, ctaKey, href }: {
  n: number;
  icon: React.ReactNode;
  titleKey: TKey; bodyKey: TKey; ctaKey: TKey;
  href: string;
}) {
  const t = useT();
  return (
    <div className="flex gap-4 rounded-2xl border border-brand-border-grey p-6 sm:p-7">
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-sm font-bold text-white tabular-nums">
          {n}
        </span>
        <span className="text-brand-mid-grey">{icon}</span>
      </div>
      <div className="flex-1">
        <h2 className="text-base font-bold text-brand-near-black">{t(titleKey)}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-mid-grey">{t(bodyKey)}</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black"
        >
          {t(ctaKey)}
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

export default function JallaManagementPage() {
  useForceLight();
  const t = useT();

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

      <div className="mt-10 flex flex-col gap-4">
        <Step
          n={1}
          icon={<CalendarClock className="size-4" />}
          titleKey="jallaManagement.step1Title"
          bodyKey="jallaManagement.step1Body"
          ctaKey="jallaManagement.step1Cta"
          href={JALLA_MANAGEMENT_CALL_URL}
        />
        <Step
          n={2}
          icon={<ClipboardList className="size-4" />}
          titleKey="jallaManagement.step2Title"
          bodyKey="jallaManagement.step2Body"
          ctaKey="jallaManagement.step2Cta"
          href={JALLA_MANAGEMENT_FORM_URL}
        />
      </div>

      <p className="mt-8 text-xs leading-relaxed text-brand-mid-grey">
        {t('jallaManagement.footnote')}
      </p>
    </div>
  );
}
