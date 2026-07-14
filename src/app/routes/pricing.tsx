import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase, ArrowRight } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  icon: React.ReactNode;
  name: string;
  tagline: string;
  price: string;
  priceNote?: string;
  cta: string;
  ctaHref: string;
  highlighted: boolean;
  badge?: string;
  features: PlanFeature[];
}

// ── Plans config ───────────────────────────────────────────

const PLANS: Plan[] = [
  {
    icon: <BadgeCheck className="size-5" />,
    name: 'Self Verify',
    tagline: 'For hands-on homeowners who want full control.',
    price: 'Free',
    cta: 'Get started',
    ctaHref: '/auth/signup',
    highlighted: false,
    features: [
      { text: 'Up to 3 projects',              included: true  },
      { text: 'Self-approve stages',            included: true  },
      { text: 'Evidence upload per substage',   included: true  },
      { text: 'Document vault',                 included: true  },
      { text: 'Project chat',                   included: true  },
      { text: '1 contractor per project',       included: true  },
      { text: 'Jalla-verified stages',          included: false },
      { text: 'Unlimited projects',             included: false },
      { text: 'Dedicated project manager',      included: false },
    ],
  },
  {
    icon: <ShieldCheck className="size-5" />,
    name: 'Jalla Verify',
    tagline: 'Independent verification on every stage — so you can pay with confidence.',
    price: '$199',
    priceNote: '/ mo',
    cta: 'Start Jalla Verify',
    ctaHref: '/auth/signup',
    highlighted: true,
    badge: 'Most popular',
    features: [
      { text: 'Unlimited projects',             included: true  },
      { text: 'Jalla-verified stages',          included: true  },
      { text: 'Evidence upload per substage',   included: true  },
      { text: 'Document vault',                 included: true  },
      { text: 'Project chat',                   included: true  },
      { text: 'Unlimited contractors',          included: true  },
      { text: 'Priority support',               included: true  },
      { text: 'Everything in Self Verify',      included: true  },
      { text: 'Dedicated project manager',      included: false },
    ],
  },
  {
    icon: <Briefcase className="size-5" />,
    name: 'Jalla Management',
    tagline: 'Full-service. Jalla manages your project end-to-end.',
    price: 'Custom',
    cta: 'Contact us',
    ctaHref: 'mailto:hello@tryjalla.com',
    highlighted: false,
    features: [
      { text: 'Unlimited projects',             included: true  },
      { text: 'Dedicated project manager',      included: true  },
      { text: 'On-site representation',         included: true  },
      { text: 'Procurement oversight',          included: true  },
      { text: 'Jalla-verified stages',          included: true  },
      { text: 'Custom reporting',               included: true  },
      { text: 'Priority support',               included: true  },
      { text: 'Everything in Jalla Verify',     included: true  },
      { text: 'White-glove onboarding',         included: true  },
    ],
  },
];

// ── FAQ ────────────────────────────────────────────────────

const FAQ = [
  {
    q: 'What does "Jalla-verified" mean?',
    a: 'When you submit a stage for review, Jalla\'s team inspects the uploaded evidence — photos, invoices, certifications — and confirms the work matches the specification before you release any payment.',
  },
  {
    q: 'Can I upgrade from Self Verify later?',
    a: 'Yes. Upgrading is instant — your existing projects carry over and Jalla begins reviewing your current active stage from the point you upgrade.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'Your project data, documents, and evidence are retained for 90 days after cancellation. You can export everything before then.',
  },
  {
    q: 'Does Jalla Verify cover international builds?',
    a: 'Yes. Jalla Verify is available in all markets where Groundwork is supported. Local knowledge is factored into every stage review.',
  },
];

// ── Components ─────────────────────────────────────────────

function PlanCard({ plan, index }: { plan: Plan; index: number }) {
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
      {plan.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-brand-near-black text-white text-[10px] font-semibold tracking-wide uppercase px-3 py-1">
          {plan.badge}
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
        <span className="font-bold text-brand-near-black text-base">{plan.name}</span>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-4xl font-black text-brand-near-black">{plan.price}</span>
        {plan.priceNote && <span className="text-sm text-brand-mid-grey">{plan.priceNote}</span>}
      </div>

      <p className="text-sm text-brand-mid-grey leading-relaxed mb-6">{plan.tagline}</p>

      {/* Features */}
      <ul className="flex flex-col gap-2.5 mb-8 flex-1">
        {plan.features.map(f => (
          <li key={f.text} className={`flex items-start gap-2.5 text-sm ${f.included ? 'text-brand-near-black' : 'text-brand-mid-grey line-through'}`}>
            {f.included ? (
              <span className="mt-0.5 shrink-0 flex size-4 items-center justify-center rounded-full bg-brand-near-black">
                <Check className="size-2.5 text-white stroke-[2.5]" />
              </span>
            ) : (
              <span className="mt-0.5 shrink-0 size-4 rounded-full border border-brand-border-grey" />
            )}
            {f.text}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <Link
        to={plan.ctaHref}
        className={[
          'flex items-center justify-center gap-2 rounded-xl text-sm font-semibold px-4 py-3 transition-colors',
          plan.highlighted
            ? 'bg-brand-near-black text-white hover:bg-black'
            : 'bg-brand-light-grey text-brand-near-black hover:bg-brand-border-grey',
        ].join(' ')}
      >
        {plan.cta}
        <ArrowRight className="size-3.5" />
      </Link>
    </motion.div>
  );
}

// ── Page ───────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Nav */}
      <nav className="border-b border-brand-border-grey px-5 sm:px-8 py-4 flex items-center justify-between">
        <Link to="/" className="flex flex-col leading-none">
          <span className="text-base font-black text-brand-near-black tracking-tight">Groundwork</span>
          <span className="text-[10px] text-brand-mid-grey">by Jalla</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/auth/login" className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors">
            Log in
          </Link>
          <Link
            to="/auth/signup"
            className="text-sm font-semibold bg-brand-near-black text-white px-4 py-2 rounded-xl hover:bg-black transition-colors"
          >
            Get started
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-brand-mid-grey mb-4">
            Simple, transparent pricing
          </p>
          <h1 className="font-sans text-4xl sm:text-5xl font-black text-brand-near-black leading-tight mb-4">
            Build with confidence.<br />Pay only when work is done.
          </h1>
          <p className="text-brand-mid-grey text-lg max-w-xl mx-auto leading-relaxed">
            Start free. Upgrade when you're ready for Jalla to verify every stage before you release a naira or dollar.
          </p>
        </motion.div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.name} plan={plan} index={i} />
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-brand-near-black mb-8 text-center">
            Common questions
          </h2>
          <div className="flex flex-col gap-6">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <p className="text-sm font-semibold text-brand-near-black mb-1.5">{q}</p>
                <p className="text-sm text-brand-mid-grey leading-relaxed">{a}</p>
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
            Ready to track your build?
          </h2>
          <p className="text-brand-soft-grey mb-8 text-sm leading-relaxed">
            Start for free — no card required. Upgrade any time once you need Jalla's eyes on your site.
          </p>
          <Link
            to="/auth/signup"
            className="inline-flex items-center gap-2 bg-white text-brand-near-black font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-brand-off-white transition-colors"
          >
            Create your account
            <ArrowRight className="size-4" />
          </Link>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="border-t border-brand-border-grey px-5 sm:px-8 py-6 flex items-center justify-between text-xs text-brand-mid-grey">
        <span>© {new Date().getFullYear()} Jalla. All rights reserved.</span>
        <div className="flex items-center gap-4">
          <Link to="/" className="hover:text-brand-near-black transition-colors">Home</Link>
          <Link to="/community" className="hover:text-brand-near-black transition-colors">Community</Link>
        </div>
      </footer>
    </div>
  );
}
