import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudget } from '@/lib/budget';
import { createProject } from '@/lib/supabase/projects';
import { useAuth } from '@/contexts/AuthContext';
import { useTierBilling } from '@/lib/tier-labels';
import type { ProjectTier } from '@/types/project';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// =========================================================
// Design A, in selection form.
//
// This step used to carry its own hardcoded copy of the three plans — a fifth
// copy after the four that payments/config.ts consolidated, and one that had
// drifted: it omitted the 10% processing fee and the one-contractor limit, at
// the exact moment someone commits to a tier. The words now come from
// `useTierBilling()`, the same source as /upgrade, so the two screens cannot
// disagree and both translate.
//
// The difference from /upgrade is the interaction, not the layout: here the card
// *is* the control (nothing is being bought yet — the wizard's own button
// submits), so there is no per-card CTA and selection is shown by a ring.
// =========================================================

const ORDER: ProjectTier[] = ['self_verify', 'jalla_verify', 'jalla_management'];

const ICON: Record<ProjectTier, React.ReactNode> = {
  self_verify:      <BadgeCheck className="size-4" />,
  jalla_verify:     <ShieldCheck className="size-4" />,
  jalla_management: <Briefcase className="size-4" />,
};

/** The plan we actually sell gets the dark column, as on /upgrade. */
const FEATURED: ProjectTier = 'jalla_verify';

export default function Step10PlanSelection() {
  const t = useT();
  const { data, update, reset, next, constructionRate, cityRate } = useWizard();
  const { user } = useAuth();
  const navigate = useNavigate();
  const tiers = useTierBilling();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  /**
   * Jalla Management cannot confirm its own budget — a Jalla admin produces and confirms
   * that figure after creation — so those projects are created here and open with a
   * "preparing your budget" banner. The other two tiers go on to step 11 and confirm
   * their figure before the project exists.
   */
  async function handleSubmit() {
    if (!user) return;
    if (data.tier !== 'jalla_management') { next(); return; }

    setError(null);
    setSubmitting(true);
    try {
      const budget  = calculateBudget(data, constructionRate, cityRate);
      const project = await createProject(user.id, data, budget);
      reset();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wizard.s10CreateFailed'));
      setSubmitting(false);
    }
  }

  return (
    <WizardShell
      canContinue={!!data.tier}
      onContinue={handleSubmit}
      continueLabel={t('wizard.s10CreateProject')}
      isSubmitting={submitting}
      wide
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s10Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s10Note')}
        </p>

        <div className="mt-8 grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
          {ORDER.map((id, i) => {
            const d        = tiers[id];
            const featured = id === FEATURED;
            const selected = data.tier === id;

            return (
              <motion.button
                key={id}
                type="button"
                onClick={() => update({ tier: id })}
                aria-pressed={selected}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.06 * i, ease: 'easeOut' }}
                className={cn(
                  // rounded-2xl, not rounded-xl: globals.css inverts
                  // `.bg-brand-near-black.text-white.rounded-xl` in dark mode, which would
                  // turn the featured column white.
                  'relative flex h-full w-full flex-col rounded-2xl border p-4 text-left transition-all duration-150 sm:p-5',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                  featured
                    ? 'border-brand-near-black bg-brand-near-black text-white shadow-[0_12px_40px_rgba(0,0,0,0.14)]'
                    : 'border-brand-border-grey bg-white hover:border-brand-dark-grey',
                  selected && 'ring-2 ring-brand-near-black ring-offset-2',
                )}
              >
                {d.tag && !selected && (
                  <span className={cn(
                    'absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em]',
                    featured ? 'bg-white text-brand-near-black' : 'bg-brand-near-black text-white',
                  )}>
                    {d.tag}
                  </span>
                )}

                {selected && (
                  <span className={cn(
                    'absolute -top-2.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full',
                    featured ? 'bg-white' : 'bg-brand-near-black',
                  )}>
                    <Check className={cn('size-3 stroke-3', featured ? 'text-brand-near-black' : 'text-white')} />
                  </span>
                )}

                <div className={cn('mb-1 flex items-center gap-2', featured ? 'text-white/70' : 'text-brand-mid-grey')}>
                  {ICON[id]}
                  <span className="text-sm font-bold">{d.name}</span>
                </div>

                <div className="mb-2.5 flex items-baseline gap-1">
                  <span className="text-2xl font-black tracking-tight sm:text-3xl">{d.price}</span>
                  {d.period && (
                    <span className={cn('text-sm', featured ? 'text-white/50' : 'text-brand-mid-grey')}>{d.period}</span>
                  )}
                </div>

                <p className={cn('mb-5 text-xs leading-relaxed', featured ? 'text-white/55' : 'text-brand-mid-grey')}>
                  {d.desc}
                </p>

                <div className="flex flex-1 flex-col gap-2.5">
                  {d.features.map(f => (
                    <div key={f} className="flex items-start gap-2.5">
                      {/* Monochrome tick — a feature being present is not a status. */}
                      <span className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                        featured ? 'bg-white/15' : 'bg-brand-off-white',
                      )}>
                        <Check className={cn('size-2.5 stroke-3', featured ? 'text-white' : 'text-brand-near-black')} />
                      </span>
                      <span className={cn('text-xs leading-snug', featured ? 'text-white/85' : 'text-brand-near-black')}>
                        {f}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Selected plan summary */}
        {data.tier && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 flex items-center gap-2.5 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3"
          >
            <span className="text-brand-mid-grey">{ICON[data.tier]}</span>
            <p className="text-xs text-brand-mid-grey">
              {t('wizard.s10Selected', { plan: tiers[data.tier].name })}
            </p>
          </motion.div>
        )}

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black"
          >
            {error}
          </motion.p>
        )}
      </div>
    </WizardShell>
  );
}
