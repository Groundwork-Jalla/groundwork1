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
import { startProjectTracking, adminStartProjectTracking, adminStartProjectAtStage } from '@/lib/supabase/tracking';
import { STAGE_KEYS } from '@/lib/projects/stage-from-description';
import { joinedBudget } from '@/lib/budget/joined-project';
import { uploadDocument } from '@/lib/supabase/documents';
import { FILE_ACCEPT_ATTR, MAX_FILE_MB, fileProblem } from '@/lib/documents/accepted-files';
import { useFormat, useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/errors';

const ATTACHMENT_UPLOAD_TIMEOUT_MS = 20_000;

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
  const { data, constructionRate, cityRate, onBehalfOf,
    clearDraft, confirmationDraft, updateConfirmationDraft, pendingDocuments,
    planDocumentsSeen } = useWizard();
  const { user, isContractor }  = useAuth();
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

  /**
   * They uploaded a plan and a bill, and a reload threw the Files away.
   *
   * The wizard no longer sends them back to the architecture-plan question over this
   * — that is what put partners back at the very first screen — but the documents
   * really are gone, and this is the last point at which anyone can say so. Without
   * the box the project would be created priced from a bill it does not hold, and
   * nobody would be told.
   */
  const planFilesLost = data.hasArchitecturePlan === true && planDocumentsSeen
    && !((pendingDocuments ?? []).some(doc => doc.category === 'other')
      && (pendingDocuments ?? []).some(doc => doc.category === 'boq'));

  // ── A build that was already under way (103) ──────────────────────────────────────
  // Admin-only, because only the admin path can mark stages as already built. A partner
  // contractor bringing a half-finished house describes it in their own words; the stage is
  // proposed from that and the admin confirms or overrides it. Nothing is applied from the
  // guess alone — the consequence of being wrong is a real stage marked done that nobody
  // built, or a client billed again for a floor they paid for last year.
  const [stageOverride, setStageOverride] = useState<number | null>(confirmationDraft?.stageOverride ?? null);

  /**
   * The stage this build has reached. 1 means nothing built yet.
   *
   * No longer gated behind a checkbox, so there is no "undecided" state to refuse:
   * the list always shows a stage and the default is the honest one.
   */
  const startStage = stageOverride ?? 1;

  useEffect(() => {
    updateConfirmationDraft?.({
      raw, alreadyStarted: startStage > 1, described: '', stageOverride,
      hadAttachment: !!file || needsReattachment,
    });
  }, [raw, startStage, stageOverride, file, needsReattachment, updateConfirmationDraft]);

  // The stage schedule's own names, by number. `useStageLabels` wants a stage ROW; here there
  // is no project yet, only a position on the scale.
  const stageLabel = (n: number) => t(`stages.${STAGE_KEYS[n - 1]}` as TKey);

  // Chosen, not inferred. `stageFromDescription` read a stage out of a sentence and
  // the dropdown overrode it; now the dropdown IS the answer, so there is one source
  // and nothing to disagree with it.

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

  const canSubmit = finalBudget > 0 && !busy;

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

      // Whoever is creating it. The stage someone picked decides which stages are
      // recorded as already built, and that is just as true of a client setting up
      // their own half-finished house as of a partner doing it for them. It used to
      // be gated on `onBehalfOf`, so a client's choice was read, shown back to them,
      // and then silently dropped — the project opened at stage 1 regardless.
      if (joined) {
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
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            uploadDocument(project.id, ownerId, item.file, undefined, item.category),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('attachment-upload-timeout')), ATTACHMENT_UPLOAD_TIMEOUT_MS);
            }),
          ]);
        } catch {
          attachmentFailed = true;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      clearDraft();

      // Nobody who is not the owner lands on the owner's project page — that view
      // assumes an owner, and a contractor dropped on it sees the client's own screen
      // and is invited to invite a contractor to the build they just made.
      //
      // `onBehalfOf` is not the whole test. A contractor can reach this wizard without
      // it — setting up a build of their own — and then fell through to the client
      // page. Reported 29 October: "after contractors create a project, they see that
      // project view as clients". Contractor standing is the real question, so it is
      // the one asked.
      if (onBehalfOf) {
        navigate(onBehalfOf.by === 'partner' ? '/work/projects' : '/admin/projects');
        return;
      }
      if (isContractor) {
        navigate('/work/projects');
        return;
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
          {/* No checkbox. It asked the same question twice: tick a box to say the
              build has started, then pick the stage it has reached — and picking a
              stage IS saying it has started. Philip, 29 October: "that checkbox
              there, let's remove it."

              Stage 1 means nothing has been built, which is the default and the
              commonest answer, so the list opens on it and anyone who is not joining
              a build in progress simply continues. */}
          <div className="rounded-xl border border-brand-border-grey px-4 py-3">
            <label className="block">
              <span className="block text-sm font-medium text-brand-near-black">
                {t('wizard.joined.stageLabel')}
              </span>
              {/* The stage is CHOSEN, never typed. It used to be a sentence a matcher
                  read a stage out of, which asks somebody to describe a thing we
                  already have the list of and then second-guesses them — and the
                  answer decides which stages are recorded as already built and what
                  the client is billed for. */}
              <select
                value={startStage}
                onChange={e => setStageOverride(Number(e.target.value))}
                className="mt-2 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
              >
                {/* The final stage is absent: a project cannot join at its own
                    handover, and 103 refuses it. */}
                {STAGE_KEYS.slice(0, -1).map((_, i) => (
                  <option key={i} value={i + 1}>{i + 1}. {stageLabel(i + 1)}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Optional supporting quote.
              Hidden in BOTH directions, for the same reason — nobody is asked twice:

                · NO  — they told us they have no drawings and no bill of quantities.
                · YES — they already uploaded one when they said so, and it is in
                        `pendingDocuments` waiting for this project to exist.

              `null` is the only case left: the question was never put, because the
              draft predates it. Then the box stays, since we genuinely do not know.

              And one more, added 28 October: YES, they uploaded both, and a RELOAD
              threw the Files away. A File cannot be drafted, so this is the only
              place left to ask for them again. */}
          {(data.hasArchitecturePlan === null || planFilesLost) && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-brand-near-black">
              {t('wizard.confirmBudget.quoteLabel')} <span className="font-normal text-brand-mid-grey">{t('common.optional')}</span>
            </span>
            {(needsReattachment || planFilesLost) && !file && (
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
