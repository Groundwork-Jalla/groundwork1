import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { FileUp, Loader2, Check } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { useAuth } from '@/contexts/AuthContext';
import { calculateBudget, decomposeBudget } from '@/lib/budget';
import { createProject } from '@/lib/supabase/projects';
import { startJallaVerifyCheckout } from '@/lib/payments/subscription';
import { startProjectTracking } from '@/lib/supabase/tracking';
import { uploadDocument } from '@/lib/supabase/documents';
import { useFormat, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/errors';

/**
 * Final wizard step — confirm the budget, then create the project.
 *
 * This is the last thing that happens before a project exists. It used to live on the
 * project detail page as a gate, which meant a project was created and then hidden behind
 * a form: the owner could not look at the build they had just costed until they filled it
 * in. Confirmation belongs here, at the end of creation.
 *
 * Jalla Management is the exception and does not reach this step — that budget is produced
 * and confirmed by a Jalla admin after creation (admin_start_project_tracking), so those
 * projects are created still awaiting tracking and show a banner instead.
 */
export default function Step11ConfirmBudget() {
  const { data, constructionRate, cityRate, reset } = useWizard();
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const t         = useT();
  const f         = useFormat();
  const fileRef   = useRef<HTMLInputElement>(null);

  const estimate  = calculateBudget(data, constructionRate, cityRate).total;
  const [raw, setRaw]       = useState(String(Math.round(estimate)));
  const [file, setFile]     = useState<File | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const finalBudget = Number(raw.replace(/[^0-9.]/g, '') || 0);
  const canSubmit   = finalBudget > 0 && !busy;

  async function handleCreate() {
    if (!user || !canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      // 1. Create the project on the wizard's own estimate.
      const budget  = calculateBudget(data, constructionRate, cityRate);
      const project = await createProject(user.id, data, budget);

      // 2. Confirm the final figure. This re-derives every stage milestone from it and
      //    activates stage 1, so the project opens ready to work rather than gated.
      //
      //    `decomposeBudget` recovers the four lines from whatever total they typed, so
      //    an edited budget still yields components that sum to THEIR number. The design
      //    fee is priced per built m², hence the shape.
      await startProjectTracking(
        project.id,
        decomposeBudget(finalBudget, { builtAreaSqm: (data.sqm ?? 0) * (data.floors ?? 1) }),
      );

      // 3. The quote, if they attached one. Only possible now that a project id exists,
      //    and deliberately not fatal — a failed upload must not lose the project.
      if (file) {
        try {
          await uploadDocument(project.id, user.id, file, undefined, 'contract');
        } catch {
          // surfaced in the project's Documents tab instead; the build is created
        }
      }

      reset();

      // A paid plan goes to Stripe, not straight to the project.
      //
      // Picking Jalla Verify used to CREATE a Jalla Verify project — no charge, no
      // checkout, and the entitlements (unlimited projects, unlimited contractor
      // invites) granted on the strength of a radio button. The database now clamps a
      // new project to whatever the subscription actually grants (061), so this is the
      // other half: send them to pay for what they chose.
      //
      // The project is created FIRST and on the free plan, deliberately. Their work is
      // safe whatever happens at Stripe, and if they abandon checkout they keep the
      // project rather than losing eleven steps of wizard. Payment then upgrades it
      // through profiles.subscription_tier -> sync_projects_to_subscription (021).
      if (data.tier === 'jalla_verify') {
        try {
          await startJallaVerifyCheckout(`/projects/${project.id}`);
          return;                       // the browser is leaving for Stripe
        } catch {
          // Checkout unreachable. The project exists and is usable on the free plan, so
          // land them on it rather than stranding them on a dead wizard step; the
          // upgrade prompt is waiting for them there.
        }
      }

      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
      setBusy(false);
    }
  }

  const diff    = finalBudget - estimate;
  const diffPct = estimate > 0 ? (diff / estimate) * 100 : 0;

  return (
    <WizardShell canContinue={false} onContinue={() => {}}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.confirmBudget.title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.confirmBudget.subtitle')}
        </p>

        <div className="mt-7 space-y-4">
          {/* Groundwork's own estimate, read-only */}
          <div className="rounded-xl bg-brand-off-white px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-brand-mid-grey">{t('wizard.confirmBudget.estimateLabel')}</span>
            <span className="text-sm font-semibold text-brand-near-black figure">{f.money(estimate)}</span>
          </div>

          {/* The figure that becomes the project budget */}
          <div className="space-y-1.5">
            <label htmlFor="final-budget" className="text-sm font-medium text-brand-near-black">
              {t('wizard.confirmBudget.finalLabel')}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-mid-grey">$</span>
              <input
                id="final-budget"
                inputMode="numeric"
                // Grouping stays locale-neutral: this is an input mask and the parse
                // strips [^0-9.], so a French decimal comma would be silently eaten.
                value={raw === '0' ? '' : Number(raw.replace(/[^0-9.]/g, '') || 0).toLocaleString('en-US')}
                onChange={e => setRaw(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl border border-brand-border-grey bg-white pl-9 pr-4 py-3 text-lg font-bold figure text-brand-near-black focus:outline-none focus:border-brand-near-black transition-colors"
              />
            </div>
            <p className="text-xs text-brand-mid-grey">{t('wizard.confirmBudget.finalHint')}</p>
            {Math.abs(diffPct) >= 1 && (
              <p className="text-xs text-brand-mid-grey">
                {t('wizard.confirmBudget.difference', {
                  amount: f.money(Math.abs(diff)),
                  pct: Math.abs(Math.round(diffPct)),
                  direction: diff > 0
                    ? t('wizard.confirmBudget.above')
                    : t('wizard.confirmBudget.below'),
                })}
              </p>
            )}
          </div>

          {/* Optional supporting quote */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-brand-near-black">
              {t('wizard.confirmBudget.quoteLabel')} <span className="font-normal text-brand-mid-grey">{t('common.optional')}</span>
            </span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
                file ? 'border-brand-near-black bg-brand-off-white' : 'border-brand-border-grey hover:border-brand-dark-grey',
              )}
            >
              {file ? (
                <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-near-black">
                  <Check className="size-3.5" /> {file.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-xs text-brand-mid-grey">
                  <FileUp className="size-3.5" /> {t('wizard.confirmBudget.quoteCta')}
                </span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,image/*"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && <p className="text-xs text-state-alert" role="alert">{error}</p>}

          <motion.button
            type="button"
            disabled={!canSubmit}
            onClick={handleCreate}
            whileTap={{ scale: 0.99 }}
            className="w-full rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3.5 hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? t('wizard.confirmBudget.creating') : t('wizard.confirmBudget.cta')}
          </motion.button>

          <p className="text-[11px] text-brand-mid-grey text-center leading-relaxed">
            {t('wizard.confirmBudget.note')}
          </p>
        </div>
      </div>
    </WizardShell>
  );
}
