import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { FileUp, Loader2, Check } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { useAuth } from '@/contexts/AuthContext';
import { calculateBudget, decomposeBudget } from '@/lib/budget';
import { supabase } from '@/lib/supabase/client';
import { createProject } from '@/lib/supabase/projects';
import { takeOwnClientProject } from '@/lib/supabase/contractor-clients';
import { startJallaVerifyCheckout } from '@/lib/payments/subscription';
import { startProjectTracking, adminStartProjectTracking, adminStartProjectAtStage } from '@/lib/supabase/tracking';
import { STAGE_KEYS } from '@/lib/projects/stage-from-description';
import { joinedBudget } from '@/lib/budget/joined-project';
import { uploadDocument } from '@/lib/supabase/documents';
import { FILE_ACCEPT_ATTR, MAX_FILE_MB, fileProblem } from '@/lib/documents/accepted-files';
import { useFormat, useT, type TKey } from '@/lib/i18n';
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
  const { data, constructionRate, cityRate, reset, onBehalfOf,
    confirmationDraft, updateConfirmationDraft, pendingDocuments } = useWizard();
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const t         = useT();
  const f         = useFormat();
  const fileRef   = useRef<HTMLInputElement>(null);

  /**
   * What the budget starts at.
   *
   * On the architecture-plan path the bill of quantities IS the budget — there was
   * nothing to estimate, so the estimator's figure would be a guess sitting where a
   * real number belongs. `bqTotalUsd` is only ever set from a reading we were
   * confident in, and it is still shown here to be confirmed or corrected before
   * anything is created, because it becomes the payment at every stage.
   *
   * A saved draft wins over both: it is what this person last typed.
   */
  const estimate  = calculateBudget(data, constructionRate, cityRate).total;
  const documentFlow = data.hasArchitecturePlan === true;
  const opening   = data.bqTotalUsd ?? (documentFlow ? null : estimate);
  // The budget is confirmed on the summary screen; this step only reads it.
  const raw = confirmationDraft?.raw
    ?? (opening == null ? '' : String(Math.round(opening)));
  const [file, setFile]     = useState<File | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [needsReattachment] = useState(confirmationDraft?.hadAttachment === true);

  // ── A build that was already under way (103) ──────────────────────────────────────
  // Admin-only, because only the admin path can mark stages as already built. A partner
  // contractor bringing a half-finished house describes it in their own words; the stage is
  // proposed from that and the admin confirms or overrides it. Nothing is applied from the
  // guess alone — the consequence of being wrong is a real stage marked done that nobody
  // built, or a client billed again for a floor they paid for last year.
  const [alreadyStarted, setAlreadyStarted] = useState(confirmationDraft?.alreadyStarted ?? false);
  const [stageOverride, setStageOverride] = useState<number | null>(confirmationDraft?.stageOverride ?? null);

  useEffect(() => {
    updateConfirmationDraft?.({
      raw, alreadyStarted, described: '', stageOverride,
      hadAttachment: !!file || needsReattachment,
    });
  }, [raw, alreadyStarted, stageOverride, file, needsReattachment, updateConfirmationDraft]);

  // The stage schedule's own names, by number. `useStageLabels` wants a stage ROW; here there
  // is no project yet, only a position on the scale.
  const stageLabel = (n: number) => t(`stages.${STAGE_KEYS[n - 1]}` as TKey);

  // Chosen, not inferred. `stageFromDescription` read a stage out of a sentence and
  // the dropdown overrode it; now the dropdown IS the answer, so there is one source
  // and nothing to disagree with it.
  const startStage = alreadyStarted ? stageOverride : 1;

  const finalBudget = Number(raw.replace(/[^0-9.]/g, '') || 0);

  // What the client will actually be asked for. Recomputed from the confirmed total, so an
  // admin who edits the budget sees the joined figure follow.
  const joined = useMemo(() => {
    if (!startStage || startStage <= 1 || finalBudget <= 0) return null;
    const fullBreakdown = decomposeBudget(finalBudget, {
      builtAreaSqm: (data.sqm ?? 0) * (data.floors ?? 1),
      floors:       data.floors ?? 1,
    });
    return joinedBudget(fullBreakdown, startStage);
  }, [startStage, finalBudget, data.sqm, data.floors]);

  // Saying the build is under way means naming the stage. Until one is picked
  // `startStage` is null and this refuses to continue — the answer decides which
  // stages are recorded as already built and what the client is billed for.
  const stageDecided = !alreadyStarted || (startStage !== null && startStage >= 1);
  const canSubmit   = finalBudget > 0 && !busy && stageDecided;

  async function handleCreate() {
    if (!user || !canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      // ── Make sure the session is still alive BEFORE writing anything ──
      //
      // The wizard guards on load, but it guards on a session OBJECT, not a valid one.
      // Eleven steps and a budget review can outlast a one-hour token, and AuthContext
      // goes on holding the stale one — so the page looks signed in while every policy
      // on `projects` sees `auth.uid() = NULL` and refuses the insert. What the client
      // got was "new row violates row-level security policy" at step eleven.
      //
      // `getSession()` refreshes a stale token when a refresh token is still good, which
      // makes the common case simply work. When it cannot, we stop here — BEFORE the
      // write — and leave every answer on screen. Client/admin wizards keep answers in
      // memory, and browser storage may be unavailable even for a saved contractor draft.
      const { data: { session: live } } = await supabase.auth.getSession();
      if (!live) {
        setError(t('wizard.confirmBudget.errSignedOut'));
        setBusy(false);
        return;
      }

      // The project belongs to the CLIENT. When an admin is running the wizard on their
      // behalf, every row below is written as the client's — their dashboard, their
      // access — and the admin is recorded as its creator by the database (082).
      const ownerId = onBehalfOf?.userId ?? user.id;

      // 1. Create the project on the wizard's own estimate.
      const shape = {
        builtAreaSqm: (data.sqm ?? 0) * (data.floors ?? 1),
        floors: data.floors ?? 1,
      };
      const budget = documentFlow
        ? decomposeBudget(finalBudget, shape)
        : calculateBudget(data, constructionRate, cityRate);
      // Fixed tiers survive the skipped plan picker: a partner creates Self Verify,
      // while an admin creates Jalla Management. The override also wins over any stale
      // form selection. Paid plans chosen by clients still go through checkout below.
      const project = await createProject(ownerId, data, budget,
        onBehalfOf?.tier ? { tier: onBehalfOf.tier } : {});

      // 2. Confirm the final figure. This re-derives every stage milestone from it and
      //    activates stage 1, so the project opens ready to work rather than gated.
      //
      //    `decomposeBudget` recovers the four lines from whatever total they typed, so
      //    an edited budget still yields components that sum to THEIR number. The design
      //    fee is priced per built m², hence the shape.
      //
      //    An admin confirms through the admin RPC, which is what the Management tier
      //    was always meant to use — the client is notified that their budget is set.
      const confirmed = decomposeBudget(finalBudget, {
        builtAreaSqm: (data.sqm ?? 0) * (data.floors ?? 1),
        floors:       data.floors ?? 1,
      });
      // A partner takes their place on the project FIRST: membership and primary standing
      // (109). Creating it does not do that, and the budget call below is gated on being
      // the client's partner — so doing this second would fail on a project they own.
      if (onBehalfOf?.by === 'partner') {
        await takeOwnClientProject(project.id);
      }

      if (onBehalfOf && joined) {
        // Joining a build in progress: the earlier stages are recorded as already built and
        // the client is billed only for what is left (103).
        // The note is the stage they CHOSE. It used to be whatever they typed; with
        // no text box there is nothing to pass but the thing they actually told us.
        await adminStartProjectAtStage(project.id, joined, ownerId, project.name,
          startStage ? stageLabel(startStage) : '');
      } else if (onBehalfOf) {
        // Named `admin…` for the RPC it calls; 109 widened that function to accept a
        // partner for their own client's project, so this one call serves both.
        await adminStartProjectTracking(project.id, confirmed, ownerId, project.name);
      } else {
        await startProjectTracking(project.id, confirmed);
      }

      // 3. The costing they attached, if any. Only possible now that a project id
      //    exists, and deliberately not fatal — a failed upload must not lose the
      //    project. Filed as 'boq': it is the number this build is priced on, not a
      //    contract, and the Documents tab has a filter for it (migration 096).
      //
      //    A failure used to be swallowed entirely, with a comment claiming the
      //    Documents tab would show it — nothing did. The person deliberately attached
      //    this file, so they are told, on the project page they land on.
      //    The floor plan and bill of quantities from the architecture-plan question
      //    go up here too, for the same reason and with the same tolerance: there was
      //    no project to attach them to until now, and losing the project because a
      //    file failed would be the worse outcome. The person is told either way.
      let attachmentFailed = false;
      const toUpload: { file: File; category: 'other' | 'boq' }[] = [
        ...(pendingDocuments ?? []),
        ...(file ? [{ file, category: 'boq' as const }] : []),
      ];
      for (const item of toUpload) {
        try {
          await uploadDocument(project.id, ownerId, item.file, undefined, item.category);
        } catch {
          attachmentFailed = true;
        }
      }

      reset();

      // Neither an admin nor a partner goes to Stripe, and neither lands on the client's
      // own project page — that view assumes an owner. They go back to their own surface.
      if (onBehalfOf) {
        navigate(onBehalfOf.by === 'partner' ? '/work/projects' : '/admin/projects');
        return;
      }

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
          await startJallaVerifyCheckout(`/projects/${project.id}${attachmentFailed ? '?attachment=failed' : ''}`);
          return;                       // the browser is leaving for Stripe
        } catch {
          // Checkout unreachable. The project exists and is usable on the free plan, so
          // land them on it rather than stranding them on a dead wizard step; the
          // upgrade prompt is waiting for them there.
        }
      }

      navigate(`/projects/${project.id}${attachmentFailed ? '?attachment=failed' : ''}`);
    } catch (err) {
      // ── Why this is not just `errorMessage(err)` ──
      //
      // Every INSERT policy on `projects` reads `auth.uid()` — the owner's own check, the
      // admin check and the partner check alike. When the session has quietly expired,
      // `auth.uid()` is NULL, all three fail, and Postgres says only "new row violates
      // row-level security policy", which was shown to the client verbatim at the end of
      // an eleven-step wizard. It reads like the product is broken; it usually means they
      // need to sign in again.
      //
      // So a permission refusal asks the session whether it is still there, and says
      // which of the two it is.
      const code = (err as { code?: string } | null)?.code;
      if (code === '42501') {
        const { data: { session } } = await supabase.auth.getSession();
        setError(t(session ? 'wizard.confirmBudget.errRefused' : 'wizard.confirmBudget.errSignedOut'));
      } else {
        setError(errorMessage(err, t('common.somethingWrong')));
      }
      setBusy(false);
    }
  }

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
          {/* Asked of everybody. A client with a half-built house is the commonest
              reason somebody arrives here, and gating this on `onBehalfOf` meant the
              only people who could say so were staff and contractors. */}
          <div className="rounded-xl border border-brand-border-grey px-4 py-3">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox" checked={alreadyStarted}
                  onChange={e => { setAlreadyStarted(e.target.checked); setStageOverride(null); }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-brand-near-black">
                    {t('wizard.joined.question')}
                  </span>
                  <span className="block text-xs text-brand-mid-grey">{t('wizard.joined.hint')}</span>
                </span>
              </label>

              {alreadyStarted && (
                <div className="mt-3 space-y-2.5 border-t border-brand-border-grey pt-3">
                  {/* The stage is CHOSEN, never typed.
                      It used to be a sentence that a matcher read a stage out of, with
                      the dropdown as an override. That asks somebody to describe a
                      thing we already have the list of, and then second-guesses them —
                      and the answer decides which stages are marked already built and
                      what the client is billed for. A list of our own stages is the
                      only answer that cannot be misread. */}

                  <label className="block">
                    <span className="text-xs font-medium text-brand-near-black">{t('wizard.joined.stageLabel')}</span>
                    <select
                      value={startStage ?? ''}
                      onChange={e => setStageOverride(e.target.value ? Number(e.target.value) : null)}
                      className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
                    >
                      <option value="">{t('wizard.joined.stagePlaceholder')}</option>
                      {/* The final stage is absent: a project cannot join at its own
                          handover, and 103 refuses it. */}
                      {STAGE_KEYS.slice(0, -1).map((_, i) => (
                        <option key={i} value={i + 1}>{i + 1}. {stageLabel(i + 1)}</option>
                      ))}
                    </select>
                  </label>

                </div>
              )}
            </div>

          {/* Optional supporting quote.
              Hidden in BOTH directions, for the same reason — nobody is asked twice:

                · NO  — they told us they have no drawings and no bill of quantities.
                · YES — they already uploaded one when they said so, and it is in
                        `pendingDocuments` waiting for this project to exist.

              `null` is the only case left: the question was never put, because the
              draft predates it. Then the box stays, since we genuinely do not know. */}
          {data.hasArchitecturePlan === null && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-brand-near-black">
              {t('wizard.confirmBudget.quoteLabel')} <span className="font-normal text-brand-mid-grey">{t('common.optional')}</span>
            </span>
            {needsReattachment && !file && (
              <p role="status" className="text-xs text-brand-mid-grey">{t('wizard.confirmBudget.reattachFile')}</p>
            )}
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
              accept={FILE_ACCEPT_ATTR}
              className="hidden"
              onChange={e => {
                const picked = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (!picked) return;
                // Checked here rather than at submit: finding out the spreadsheet was
                // rejected after eleven steps and a project creation is the wrong moment.
                const problem = fileProblem(picked);
                if (problem) {
                  setFile(null);
                  setError(t(problem === 'size' ? 'wizard.confirmBudget.quoteTooLarge'
                                                : 'wizard.confirmBudget.quoteBadType', { mb: MAX_FILE_MB }));
                  return;
                }
                setError(null);
                setFile(picked);
              }}
            />
            <p className="text-[11px] leading-relaxed text-brand-mid-grey">
              {t('wizard.confirmBudget.quoteHint')}
            </p>
          </div>
          )}

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

        </div>
      </div>
    </WizardShell>
  );
}
