import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BadgeCheck,
  ShieldCheck,
  Briefcase,
  Check,
  ArrowRight,
  Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────

type Tier = 'self_verify' | 'jalla_verify' | 'enterprise_custom';
type Step = 1 | 2;

// ── Tier config ───────────────────────────────────────────

interface TierConfig {
  id: Tier;
  icon: React.ReactNode;
  name: string;
  price: string;
  priceNote?: string;
  badge?: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

const TIERS: TierConfig[] = [
  {
    id: 'self_verify',
    icon: <BadgeCheck className="size-5" />,
    name: 'Self Verify',
    price: 'Free',
    features: [
      'Up to 3 projects',
      'Self-approve stages',
      'Evidence upload',
      'Document vault',
      'Project chat',
    ],
    cta: 'Start free',
    highlighted: false,
  },
  {
    id: 'jalla_verify',
    icon: <ShieldCheck className="size-5" />,
    name: 'Jalla Verify',
    price: '$199',
    priceNote: '/ mo',
    badge: 'Most popular',
    features: [
      'Unlimited projects',
      'Jalla-verified stages',
      'Everything in Self Verify',
      'Priority support',
    ],
    cta: 'Choose Jalla Verify',
    highlighted: true,
  },
  {
    id: 'enterprise_custom',
    icon: <Briefcase className="size-5" />,
    name: 'Enterprise Custom',
    price: 'Custom',
    features: [
      'Jalla manages everything',
      'Dedicated project manager',
      'White-glove service',
      'Custom reporting',
    ],
    cta: 'Contact us',
    highlighted: false,
  },
];

// ── Slide variants ─────────────────────────────────────────

type CubicBezier = [number, number, number, number];
const EASE: CubicBezier = [0.32, 0, 0.08, 1];

const slideVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.4, ease: EASE },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? '-100%' : '100%',
    opacity: 0,
    transition: { duration: 0.35, ease: EASE },
  }),
};

// ── Step 1: Welcome ───────────────────────────────────────

function WelcomeStep({
  firstName,
  onNext,
}: {
  firstName: string;
  onNext: () => void;
}) {
  return (
    <div className="min-h-screen bg-brand-near-black flex flex-col">
      {/* Wordmark */}
      <header className="px-8 py-6">
        <div className="flex flex-col leading-none">
          <span className="font-sans text-lg font-black text-white tracking-tight">Groundwork</span>
          <span className="text-[10px] text-white/40 font-normal mt-0.5">by Jalla</span>
        </div>
      </header>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-lg w-full text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* Subtle eyebrow */}
            <p className="text-brand-mid-grey text-xs font-medium tracking-widest uppercase mb-6">
              Account setup
            </p>

            <h1 className="font-sans text-4xl sm:text-5xl font-bold text-white leading-[1.08] mb-4">
              Welcome,{' '}
              <span className="block">{firstName}</span>
            </h1>

            <p className="text-brand-mid-grey text-base sm:text-lg leading-relaxed mb-10">
              Let's set up your account.{' '}
              <span className="text-brand-soft-grey">It takes 30 seconds.</span>
            </p>

            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-2.5 bg-white text-brand-near-black font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-brand-off-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-near-black"
            >
              Get started
              <ArrowRight className="size-4" />
            </button>
          </motion.div>
        </div>
      </div>

      {/* Bottom breathing room */}
      <div className="h-16" />
    </div>
  );
}

// ── Tier card ─────────────────────────────────────────────

function TierCard({
  tier,
  index,
  loading,
  onSelect,
}: {
  tier: TierConfig;
  index: number;
  loading: boolean;
  onSelect: (id: Tier) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 + index * 0.1, ease: 'easeOut' }}
      className="flex-1 min-w-0"
    >
      <div
        className={[
          'relative flex flex-col h-full rounded-2xl border p-6 transition-shadow',
          tier.highlighted
            ? 'border-brand-near-black shadow-[0_2px_16px_0_rgba(0,0,0,0.1)]'
            : 'border-brand-border-grey',
        ].join(' ')}
      >
        {/* Popular badge */}
        {tier.badge && (
          <span className="absolute top-4 right-4 text-[10px] font-semibold tracking-wide uppercase bg-brand-near-black text-white rounded-full px-2.5 py-1">
            {tier.badge}
          </span>
        )}

        {/* Icon + name */}
        <div className="flex items-center gap-3 mb-5">
          <span
            className={[
              'flex size-9 items-center justify-center rounded-lg',
              tier.highlighted
                ? 'bg-brand-near-black text-white'
                : 'bg-brand-light-grey text-brand-near-black',
            ].join(' ')}
          >
            {tier.icon}
          </span>
          <span className="font-sans text-base font-bold text-brand-near-black">
            {tier.name}
          </span>
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-1 mb-5">
          <span className="text-3xl font-bold text-brand-near-black font-sans">
            {tier.price}
          </span>
          {tier.priceNote && (
            <span className="text-sm text-brand-mid-grey">{tier.priceNote}</span>
          )}
        </div>

        {/* Features */}
        <ul className="flex flex-col gap-2.5 mb-7 flex-1">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-brand-near-black">
              <span className="mt-0.5 shrink-0 flex size-4 items-center justify-center rounded-full bg-brand-near-black">
                <Check className="size-2.5 text-white stroke-[2.5]" />
              </span>
              {f}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(tier.id)}
          disabled={loading}
          className={[
            'w-full flex items-center justify-center gap-2 rounded-xl text-sm font-semibold px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
            tier.highlighted
              ? 'bg-brand-near-black text-white hover:bg-brand-rich-black disabled:opacity-60'
              : 'bg-brand-light-grey text-brand-near-black hover:bg-brand-pale disabled:opacity-60',
          ].join(' ')}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            tier.cta
          )}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Step 2: Plan selection ─────────────────────────────────

function PlanStep({ onSelect }: { onSelect: (tier: Tier) => Promise<void> }) {
  const [loadingTier, setLoadingTier] = useState<Tier | null>(null);

  async function handleSelect(tier: Tier) {
    if (loadingTier) return;
    setLoadingTier(tier);
    try {
      await onSelect(tier);
    } finally {
      setLoadingTier(null);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Wordmark */}
      <header className="px-8 py-6 border-b border-brand-border-grey">
        <div className="flex flex-col leading-none">
          <span className="font-sans text-lg font-black text-brand-near-black tracking-tight">Groundwork</span>
          <span className="text-[10px] text-brand-mid-grey font-normal mt-0.5">by Jalla</span>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 sm:px-6 py-12">
        <div className="w-full max-w-3xl">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-center mb-10"
          >
            <h2 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black mb-2">
              Choose your plan
            </h2>
            <p className="text-brand-mid-grey text-base">
              You can upgrade anytime. Start for free.
            </p>
          </motion.div>

          {/* Tier cards */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            {TIERS.map((tier, i) => (
              <TierCard
                key={tier.id}
                tier={tier}
                index={i}
                loading={loadingTier === tier.id}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState(1);

  // Derive first name from metadata or email
  const fullName: string =
    user?.user_metadata?.full_name ??
    user?.email?.split('@')[0] ??
    'there';
  const firstName = fullName.split(' ')[0];

  // If already onboarded, skip straight to dashboard
  useEffect(() => {
    if (user?.user_metadata?.onboarding_complete === true) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  function goToStep2() {
    setDirection(1);
    setStep(2);
  }

  async function handleTierSelect(tier: Tier) {
    if (tier === 'enterprise_custom') {
      // Open mailto and still complete onboarding
      window.open('mailto:hello@jalla.build', '_blank');
    }

    await supabase.auth.updateUser({
      data: { tier, onboarding_complete: true },
    });

    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="overflow-hidden">
      <AnimatePresence mode="wait" custom={direction}>
        {step === 1 ? (
          <motion.div
            key="step1"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <WelcomeStep firstName={firstName} onNext={goToStep2} />
          </motion.div>
        ) : (
          <motion.div
            key="step2"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <PlanStep onSelect={handleTierSelect} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
