import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForceLight } from '@/hooks/useForceLight';
import { motion } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { startGuestJallaVerifyCheckout } from '@/lib/payments/subscription';
import { errorMessage } from '@/lib/errors';
import { JALLA_MANAGEMENT_PATH } from '@/lib/jalla-management';
import { useT, type TKey } from '@/lib/i18n';

// ── Types ──────────────────────────────────────────────────

interface PlanFeature {
  key: TKey;
  included: boolean;
}

interface Plan {
  icon: React.ReactNode;
  nameKey: TKey;
  taglineKey: TKey;
  priceKey: TKey;
  priceNoteKey?: TKey;
  ctaKey: TKey;
  /** Where the CTA goes for a signed-out visitor: they need an account first. */
  ctaHref: string;
  /**
   * Where it goes once signed in. Omit for a destination that is the same either way
   * (Jalla Management opens mail to sales, which does not care about a session).
   *
   * Without this the page sent a signed-in subscriber to /auth/signup — the paid CTA
   * bounced the one visitor most likely to buy back to a form they had already filled
   * in. This page is public and, unlike the landing page, does not redirect a signed-in
   * visitor away, so it has to answer the question itself.
   */
  ctaHrefAuthed?: string;
  /**
   * This plan can be paid for without an account. Stripe collects the email at
   * checkout and the webhook provisions the account from it, so a visitor with their
   * card out is not sent to a sign-up form first.
   */
  guestCheckout?: boolean;
  highlighted: boolean;
  badgeKey?: TKey;
  features: PlanFeature[];
}

// ── Plans config ───────────────────────────────────────────

const F = 'pricing.features' as const;

const PLANS: Plan[] = [
  {
    icon: <BadgeCheck className="size-5" />,
    nameKey:    'pricing.plans.selfVerify.name',
    taglineKey: 'pricing.plans.selfVerify.tagline',
    priceKey:   'pricing.plans.selfVerify.price',
    ctaKey:     'pricing.plans.selfVerify.cta',
    ctaHref: '/auth/signup',
    ctaHrefAuthed: '/dashboard',
    highlighted: false,
    features: [
      { key: `${F}.upTo3Projects`,       included: true  },
      { key: `${F}.selfApprove`,         included: true  },
      { key: `${F}.evidenceUpload`,      included: true  },
      { key: `${F}.documentVault`,       included: true  },
      { key: `${F}.projectChat`,         included: true  },
      { key: `${F}.oneContractor`,       included: true  },
      { key: `${F}.jallaVerifiedStages`, included: false },
      { key: `${F}.unlimitedProjects`,   included: false },
      { key: `${F}.dedicatedPM`,         included: false },
    ],
  },
  {
    icon: <ShieldCheck className="size-5" />,
    nameKey:      'pricing.plans.jallaVerify.name',
    taglineKey:   'pricing.plans.jallaVerify.tagline',
    priceKey:     'pricing.plans.jallaVerify.price',
    priceNoteKey: 'pricing.plans.jallaVerify.period',
    ctaKey:       'pricing.plans.jallaVerify.cta',
    // ?redirect is read by /auth/login, so someone who already has an account and is
    // merely signed out lands on checkout rather than the dashboard.
    // Signed out this goes straight to Stripe (see guestCheckout). The href is the
    // no-JS fallback and the destination if checkout cannot be reached.
    ctaHref: '/auth/signup?redirect=%2Fupgrade',
    ctaHrefAuthed: '/upgrade',
    guestCheckout: true,
    highlighted: true,
    badgeKey: 'pricing.mostPopular',
    features: [
      { key: `${F}.unlimitedProjects`,    included: true  },
      { key: `${F}.jallaVerifiedStages`,  included: true  },
      { key: `${F}.evidenceUpload`,       included: true  },
      { key: `${F}.documentVault`,        included: true  },
      { key: `${F}.projectChat`,          included: true  },
      { key: `${F}.unlimitedContractors`, included: true  },
      { key: `${F}.prioritySupport`,      included: true  },
      { key: `${F}.everythingSelfVerify`, included: true  },
      { key: `${F}.dedicatedPM`,          included: false },
    ],
  },
  {
    icon: <Briefcase className="size-5" />,
    nameKey:    'pricing.plans.jallaManagement.name',
    taglineKey: 'pricing.plans.jallaManagement.tagline',
    priceKey:   'pricing.plans.jallaManagement.price',
    ctaKey:     'pricing.plans.jallaManagement.cta',
    // Books the project audit, then the questionnaire — see lib/jalla-management.
    ctaHref: JALLA_MANAGEMENT_PATH,
    highlighted: false,
    features: [
      { key: `${F}.unlimitedProjects`,     included: true },
      { key: `${F}.dedicatedPM`,           included: true },
      { key: `${F}.onSiteRep`,             included: true },
      { key: `${F}.procurement`,           included: true },
      { key: `${F}.jallaVerifiedStages`,   included: true },
      { key: `${F}.customReporting`,       included: true },
      { key: `${F}.prioritySupport`,       included: true },
      { key: `${F}.everythingJallaVerify`, included: true },
      { key: `${F}.whiteGlove`,            included: true },
    ],
  },
];

// ── FAQ ────────────────────────────────────────────────────

const FAQ: { q: TKey; a: TKey }[] = [
  { q: 'pricing.faq.q1', a: 'pricing.faq.a1' },
  { q: 'pricing.faq.q2', a: 'pricing.faq.a2' },
  { q: 'pricing.faq.q3', a: 'pricing.faq.a3' },
  { q: 'pricing.faq.q4', a: 'pricing.faq.a4' },
];

// ── Components ─────────────────────────────────────────────

function PlanCard({ plan, index }: { plan: Plan; index: number }) {
  const t = useT();
  const { session } = useAuth();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // React Router renders an absolute scheme (Jalla Management's mailto:) as a plain
  // anchor, so one <Link> covers both internal and external destinations.
  const href = session && plan.ctaHrefAuthed ? plan.ctaHrefAuthed : plan.ctaHref;
  // Only when signed out: a signed-in user goes through the authenticated endpoint so
  // the charge lands on the Stripe customer they already have.
  const payAsGuest = Boolean(plan.guestCheckout) && !session;

  async function handleGuestCheckout() {
    setError(null);
    setBusy(true);
    try {
      await startGuestJallaVerifyCheckout();   // navigates away; nothing after this runs
    } catch (err) {
      // Log the full error for diagnostics but show only a generic message to users.
      // The API now returns detailed errors in development; don't surface those
      // directly in the UI to avoid leaking internals or confusing visitors.
      // eslint-disable-next-line no-console
      console.error('[checkout] guest checkout failed:', err);
      setError(t('pricing.checkoutFailed'));
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + index * 0.08, ease: 'easeOut' }}
      className={[
        'relative flex flex-col rounded-2xl border p-7 transition-shadow',
        plan.highlighted
          ? 'border-brand-near-black shadow-[0_4px_24px_0_rgba(0,0,0,0.12)]'
          : 'border-brand-border-grey',
      ].join(' ')}
    >
      {plan.badgeKey && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-brand-near-black text-white text-[10px] font-semibold tracking-wide uppercase px-3 py-1">
          {t(plan.badgeKey)}
        </span>
      )}

      {/* Icon + name */}
      <div className="flex items-center gap-3 mb-4">
        <span className={[
          'flex size-9 items-center justify-center rounded-xl',
          plan.highlighted ? 'bg-brand-near-black text-white' : 'bg-brand-light-grey text-brand-near-black',
        ].join(' ')}>
          {plan.icon}
        </span>
        <span className="font-bold text-brand-near-black text-base">{t(plan.nameKey)}</span>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-4xl font-black text-brand-near-black">{t(plan.priceKey)}</span>
        {plan.priceNoteKey && <span className="text-sm text-brand-mid-grey">{t(plan.priceNoteKey)}</span>}
      </div>

      <p className="text-sm text-brand-mid-grey leading-relaxed mb-6">{t(plan.taglineKey)}</p>

      {/* Features */}
      <ul className="flex flex-col gap-2.5 mb-8 flex-1">
        {plan.features.map(f => (
          <li key={f.key} className={`flex items-start gap-2.5 text-sm ${f.included ? 'text-brand-near-black' : 'text-brand-mid-grey line-through'}`}>
            {f.included ? (
              <span className="mt-0.5 shrink-0 flex size-4 items-center justify-center rounded-full bg-brand-near-black">
                <Check className="size-2.5 text-white stroke-[2.5]" />
              </span>
            ) : (
              <span className="mt-0.5 shrink-0 size-4 rounded-full border border-brand-border-grey" />
            )}
            {t(f.key)}
          </li>
        ))}
      </ul>

      {/* CTA */}
      {payAsGuest ? (
        <button
          type="button"
          onClick={handleGuestCheckout}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-4 py-3 transition-colors hover:bg-black disabled:opacity-60"
        >
          {busy ? t('pricing.redirecting') : t(plan.ctaKey)}
          {!busy && <ArrowRight className="size-3.5" />}
        </button>
      ) : (
        <Link
          to={href}
          className={[
            'flex items-center justify-center gap-2 rounded-xl text-sm font-semibold px-4 py-3 transition-colors',
            plan.highlighted
              ? 'bg-brand-near-black text-white hover:bg-black'
              : 'bg-brand-light-grey text-brand-near-black hover:bg-brand-border-grey',
          ].join(' ')}
        >
          {t(plan.ctaKey)}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
      {error && <p className="mt-2 text-xs text-state-alert">{error}</p>}
    </motion.div>
  );
}

// ── Page ───────────────────────────────────────────────────

export default function PricingPage() {
  useForceLight();
  const t = useT();
  const { session } = useAuth();

  return (
    // Navbar and footer come from routes/_public-layout.tsx.
    <div className="bg-white font-sans">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-brand-mid-grey mb-4">
            {t('pricing.eyebrow')}
          </p>
          <h1 className="font-sans text-4xl sm:text-5xl font-black text-brand-near-black leading-tight mb-4">
            {t('pricing.title')}<br />{t('pricing.titleLine2')}
          </h1>
          <p className="text-brand-mid-grey text-lg max-w-xl mx-auto leading-relaxed">
            {t('pricing.subtitle')}
          </p>
        </motion.div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.nameKey} plan={plan} index={i} />
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-brand-near-black mb-8 text-center">
            {t('pricing.faqTitle')}
          </h2>
          <div className="flex flex-col gap-6">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <p className="text-sm font-semibold text-brand-near-black mb-1.5">{t(q)}</p>
                <p className="text-sm text-brand-mid-grey leading-relaxed">{t(a)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-20 rounded-2xl bg-brand-near-black text-white text-center px-8 py-12"
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            {t('pricing.ctaTitle')}
          </h2>
          <p className="text-brand-soft-grey mb-8 text-sm leading-relaxed">
            {t('pricing.ctaBody')}
          </p>
          <Link
            to={session ? '/dashboard' : '/auth/signup'}
            className="inline-flex items-center gap-2 bg-white text-brand-near-black font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-brand-off-white transition-colors"
          >
            {session ? t('pricing.ctaButtonSignedIn') : t('pricing.ctaButton')}
            <ArrowRight className="size-4" />
          </Link>
        </motion.div>
      </div>

    </div>
  );
}
