import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudget } from '@/lib/budget';
import { createProject } from '@/lib/supabase/projects';
import { useAuth } from '@/contexts/AuthContext';
import type { ProjectTier } from '@/types/project';
import { cn } from '@/lib/utils';

// ── Tier card ─────────────────────────────────────────────

interface TierCardProps {
  value: ProjectTier;
  title: string;
  price: string;
  description: string;
  features: string[];
  selected: boolean;
  onSelect: () => void;
  popular?: boolean;
}

function TierCard({ title, price, description, features, selected, onSelect, popular }: TierCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative w-full text-left rounded-xl border-2 p-4 transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
        selected
          ? 'border-brand-near-black bg-brand-off-white'
          : 'border-brand-border-grey hover:border-brand-dark-grey',
      )}
    >
      {popular && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-near-black text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
          Most popular
        </span>
      )}
      {selected && (
        <span className="absolute top-3 right-3 flex size-4 items-center justify-center rounded-full bg-brand-near-black">
          <Check className="size-2.5 text-white" strokeWidth={3} />
        </span>
      )}
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-sm font-bold text-brand-near-black">{title}</span>
      </div>
      <div className="text-xs font-semibold text-brand-near-black mb-1">{price}</div>
      <p className="text-xs text-brand-mid-grey mb-3 leading-relaxed">{description}</p>
      <ul className="space-y-1">
        {features.map(f => (
          <li key={f} className="flex items-start gap-1.5 text-xs text-brand-mid-grey">
            <Check className="size-3 text-brand-near-black mt-0.5 shrink-0" strokeWidth={2.5} />
            {f}
          </li>
        ))}
      </ul>
    </button>
  );
}

// ── Page component ─────────────────────────────────────────

export default function Step10PlanSelection() {
  const { data, update, reset, constructionRate } = useWizard();
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const budget  = calculateBudget(data, constructionRate);
      const project = await createProject(user.id, data, budget);
      reset();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  const tiers: TierCardProps[] = [
    {
      value:       'self_verify',
      title:       'Self Verify',
      price:       'Free',
      description: 'Self-manage your build with the full Groundwork toolkit. Up to 3 projects.',
      features:    ['Up to 3 projects', 'Budget & stage tracking', 'Document vault', 'Self-verify stages'],
      selected:    data.tier === 'self_verify',
      onSelect:    () => update({ tier: 'self_verify' }),
    },
    {
      value:       'jalla_verify',
      title:       'Jalla Verify',
      price:       '$199 / mo',
      description: 'Unlimited projects, full contractor access, and Jalla-verified stages.',
      features:    ['Unlimited projects', 'Full contractor directory', 'Jalla-verified stages', 'Priority support'],
      selected:    data.tier === 'jalla_verify',
      onSelect:    () => update({ tier: 'jalla_verify' }),
      popular:     true,
    },
    {
      value:       'jalla_management',
      title:       'Jalla Management',
      price:       'Custom',
      description: 'Jalla manages everything on your behalf. Full-service, dedicated project manager.',
      features:    ['Everything in Jalla Verify', 'Dedicated project manager', 'Procurement oversight', 'On-site representation'],
      selected:    data.tier === 'jalla_management',
      onSelect:    () => update({ tier: 'jalla_management' }),
    },
  ];

  const tierIcons: Record<string, React.ReactNode> = {
    self_verify:      <BadgeCheck className="size-4 text-brand-mid-grey" />,
    jalla_verify:     <ShieldCheck className="size-4 text-blue-600" />,
    jalla_management: <Briefcase className="size-4 text-purple-600" />,
  };

  return (
    <WizardShell
      canContinue={!!data.tier}
      onContinue={handleSubmit}
      continueLabel="Create Project"
      isSubmitting={submitting}
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Choose your plan
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          You can upgrade or change your plan at any time from settings.
        </p>

        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
          {tiers.map(tier => (
            <TierCard key={tier.value} {...tier} />
          ))}
        </div>

        {/* Selected plan summary */}
        {data.tier && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 rounded-xl bg-brand-off-white border border-brand-border-grey px-4 py-3 flex items-center gap-2.5"
          >
            {tierIcons[data.tier]}
            <p className="text-xs text-brand-mid-grey">
              <span className="font-semibold text-brand-near-black">{tiers.find(t => t.value === data.tier)?.title}</span>
              {' '}selected — you can switch any time from your settings.
            </p>
          </motion.div>
        )}

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg bg-brand-off-white border border-brand-border-grey px-4 py-3 text-sm text-brand-near-black"
          >
            {error}
          </motion.p>
        )}
      </div>
    </WizardShell>
  );
}
