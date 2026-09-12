import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, RotateCcw, Loader2, ImageIcon, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ownerLookup } from '@/lib/supabase/admin-users';
import { useAuth } from '@/contexts/AuthContext';
import { adminApproveStage, adminRequestRework } from '@/lib/supabase/approvals';
import {
  listProjectVerifications, latestForStage, requestVerification, recordVerification,
  type StageVerification, type VerificationDecision,
} from '@/lib/supabase/verifications';
import { listProjectVerifiers, type ProjectVerifier } from '@/lib/supabase/verifiers';
import { listAdminUsers } from '@/lib/supabase/admin-users';
import { stageLifecycle } from '@/lib/lifecycle/stage';
import { errorMessage } from '@/lib/errors';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useT } from '@/lib/i18n';

interface PendingStage {
  stageId: string;
  stageNumber: number;
  stageName: string;
  projectId: string;
  projectName: string;
  ownerEmail: string;
  ownerName: string;
  submittedAt: string | null;
  substages: PendingSubstage[];
  /** 086/087. `verificationRequired` is false and the rest empty when they are not applied. */
  verificationRequired: boolean;
  verificationAvailable: boolean;
  latestVerification: StageVerification | null;
  verifiers: ProjectVerifier[];
}

interface PendingSubstage {
  id: string;
  name: string;
  evidenceUrls: string[];
  status: string;
}

function EvidenceGrid({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-brand-mid-grey py-1">
        <ImageIcon className="size-3.5" />
        No evidence uploaded
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-state-active hover:underline"
        >
          <ExternalLink className="size-3" />
          Evidence {i + 1}
        </a>
      ))}
    </div>
  );
}

function ReworkModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  function handleConfirm() {
    if (!reason.trim()) return;
    onConfirm(reason.trim());
    setReason('');
  }
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-brand-near-black mb-2">{t('admin.requestChanges')}</h3>
            <p className="text-sm text-brand-mid-grey mb-4">
              Explain what needs to be corrected. The homeowner will be notified.
            </p>
            <textarea
              className="w-full h-28 rounded-xl border border-brand-border-grey px-3 py-2.5 text-sm text-brand-near-black resize-none outline-none focus:ring-2 focus:ring-brand-near-black/20"
              placeholder={t('admin.changesPlaceholder')}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            <div className="flex gap-3 mt-4 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-brand-mid-grey border border-brand-border-grey rounded-xl hover:bg-brand-off-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!reason.trim()}
                className="px-4 py-2 text-sm font-semibold bg-brand-near-black text-white rounded-xl hover:bg-black disabled:opacity-50 transition-colors"
              >
                Send feedback
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function StageReviewCard({
  item,
  onApproved,
  onReworkRequested,
}: {
  item: PendingStage;
  onApproved: (stageId: string) => void;
  onReworkRequested: (stageId: string) => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [approving, setApproving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showRework, setShowRework] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // ── Verification (087) ──
  const [verifierNames, setVerifierNames] = useState<Map<string, string>>(new Map());
  const [pickedVerifier, setPickedVerifier] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [verError, setVerError] = useState<string | null>(null);
  const [showRecord, setShowRecord] = useState(false);
  const [latest, setLatest] = useState<StageVerification | null>(item.latestVerification);

  useEffect(() => {
    // Names for the verifier picker and the status line. admin_list_users() is the
    // one place the admin can read a name for an arbitrary user id.
    if (!item.verificationAvailable || !item.verificationRequired) return;
    listAdminUsers()
      .then(users => setVerifierNames(new Map(users.map(u => [u.id, u.fullName || u.email]))))
      .catch(() => {});
  }, [item.verificationAvailable, item.verificationRequired]);

  const nameOf = (id: string | null | undefined) => (id ? (verifierNames.get(id) ?? id.slice(0, 8)) : '');

  const lifecycle = stageLifecycle(
    { id: item.stageId, stage_number: item.stageNumber, status: 'pending_review', verification_required: item.verificationRequired },
    latest ? [latest] : [],
    { status: 'active' },
  );
  const gated = item.verificationAvailable && item.verificationRequired && lifecycle.state !== 'verified';

  async function handleRequest() {
    if (!pickedVerifier) return;
    setRequesting(true); setVerError(null);
    try {
      await requestVerification(item.stageId, pickedVerifier);
      const { rows } = await listProjectVerifications(item.projectId);
      setLatest(latestForStage(rows, item.stageId));
    } catch (err) {
      const msg = errorMessage(err, '');
      setVerError(
        msg.includes('not_assigned')    ? t('admin.verification.errNotAssigned')
        : msg.includes('already_pending') ? t('admin.verification.errAlreadyPending')
        : msg || t('common.somethingWrong'),
      );
    } finally {
      setRequesting(false);
    }
  }

  async function handleRecord(input: { decision: Exclude<VerificationDecision, 'pending'>; findings: string; reason: string; visited: boolean }) {
    if (!latest) return;
    await recordVerification({
      verificationId: latest.id,
      decision:   input.decision,
      findings:   input.findings || undefined,
      visitedAt:  input.visited ? new Date().toISOString() : undefined,
      onBehalfOf: latest.verifierId,
      reason:     input.reason,
    });
    setShowRecord(false);
    if (input.decision === 'verified') {
      const { rows } = await listProjectVerifications(item.projectId);
      setLatest(latestForStage(rows, item.stageId));
    } else {
      // A rejection sent the stage back to active; it is no longer in this queue.
      onReworkRequested(item.stageId);
    }
  }

  async function handleApprove() {
    if (!user) return;
    setApproving(true); setApproveError(null);
    try {
      await adminApproveStage(item.projectId, item.stageId, item.stageNumber, user.id);
      onApproved(item.stageId);
    } catch (err) {
      // The database is the authority: `not_verified:` is what it says when this screen
      // is stale or someone tried anyway.
      const msg = errorMessage(err, '');
      setApproveError(msg.includes('not_verified') ? t('admin.verification.errNotVerified') : msg || t('common.somethingWrong'));
    } finally {
      setApproving(false);
      setConfirmApprove(false);
    }
  }

  async function handleRework(reason: string) {
    if (!user) return;
    await adminRequestRework(item.projectId, item.stageId, item.stageNumber, user.id, reason);
    onReworkRequested(item.stageId);
    setShowRework(false);
  }

  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center rounded-full bg-brand-off-white text-state-held border border-state-held/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              In Review
            </span>
            <span className="text-[10px] text-brand-mid-grey">Stage {item.stageNumber}</span>
          </div>
          <h3 className="font-semibold text-brand-near-black truncate">{item.stageName}</h3>
          <p className="text-xs text-brand-mid-grey mt-0.5 truncate">
            <Link to={`/projects/${item.projectId}`} className="hover:underline" target="_blank">
              {item.projectName}
            </Link>
            {' · '}{item.ownerName || item.ownerEmail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(p => !p)}
          className="shrink-0 flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors mt-1"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {/* Substage evidence */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-brand-border-grey divide-y divide-brand-border-grey">
              {item.substages.map(sub => (
                <div key={sub.id} className="px-5 py-3">
                  <p className="text-xs font-medium text-brand-near-black mb-1">{sub.name}</p>
                  <EvidenceGrid urls={sub.evidenceUrls} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Verification (087) */}
      {item.verificationAvailable && (
        <div className="px-5 py-4 border-t border-brand-border-grey">
          <p className="text-xs font-semibold text-brand-near-black">{t('admin.verification.title')}</p>
          {!item.verificationRequired ? (
            <p className="mt-1 text-xs text-brand-mid-grey">{t('admin.verification.notRequired')}</p>
          ) : lifecycle.state === 'verified' && latest ? (
            <div className="mt-1 text-xs text-brand-near-black">
              <p className="font-medium">{t('admin.verification.verifiedBy', { name: nameOf(latest.verifierId) })}</p>
              {latest.recordedOnBehalfOf && (
                <p className="mt-0.5 text-brand-mid-grey">
                  {t('admin.verification.onBehalf', { admin: nameOf(latest.recordedBy), reason: latest.reason ?? '' })}
                </p>
              )}
              {latest.findings && <p className="mt-1 text-brand-mid-grey">{t('admin.verification.findings')}: {latest.findings}</p>}
            </div>
          ) : latest && latest.decision === 'pending' ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-brand-near-black">
                {latest.visitedAt
                  ? t('admin.verification.awaitingVisited', { name: nameOf(latest.verifierId) })
                  : t('admin.verification.awaiting', { name: nameOf(latest.verifierId) })}
              </p>
              <button
                type="button"
                onClick={() => setShowRecord(true)}
                className="rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:bg-brand-off-white"
              >
                {t('admin.verification.recordDecision')}
              </button>
            </div>
          ) : item.verifiers.length === 0 ? (
            <p className="mt-1 text-xs text-brand-mid-grey">{t('admin.verification.noVerifiers')}</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={pickedVerifier}
                onChange={e => setPickedVerifier(e.target.value)}
                aria-label={t('admin.verification.selectVerifier')}
                className="rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-xs text-brand-near-black focus:border-brand-near-black focus:outline-none"
              >
                <option value="">{t('admin.verification.selectVerifier')}</option>
                {item.verifiers.map(pv => (
                  <option key={pv.id} value={pv.userId}>{nameOf(pv.userId)} — {pv.discipline}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRequest}
                disabled={requesting || !pickedVerifier}
                className="rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {requesting ? t('admin.verification.requesting') : t('admin.verification.request')}
              </button>
            </div>
          )}
          {verError && <p role="alert" className="mt-2 text-xs text-state-alert">{verError}</p>}
          {gated && lifecycle.state !== 'verification_pending' && (
            <p className="mt-2 text-[11px] text-brand-mid-grey">{t('admin.verification.approveBlocked')}</p>
          )}
        </div>
      )}
      {!item.verificationAvailable && item.verificationRequired && (
        <p className="px-5 py-2 text-[11px] text-brand-mid-grey border-t border-brand-border-grey">{t('admin.verification.unavailable')}</p>
      )}

      {/* Actions */}
      {approveError && <p role="alert" className="px-5 pt-3 text-xs text-state-alert">{approveError}</p>}
      <div className="px-5 py-4 border-t border-brand-border-grey flex gap-3 justify-end">
        <button
          type="button"
          onClick={() => setShowRework(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-brand-border-grey rounded-xl text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <RotateCcw className="size-4" />
          {t('admin.requestChanges')}
        </button>
        <button
          type="button"
          onClick={() => setConfirmApprove(true)}
          disabled={gated}
          title={gated ? t('admin.verification.approveBlocked') : undefined}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand-near-black text-white rounded-xl hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {approving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Approve stage
        </button>
      </div>

      <ConfirmModal
        open={confirmApprove}
        title={t('admin.approveStageTitle')}
        description={`Approving will mark Stage ${item.stageNumber} complete and unlock Stage ${item.stageNumber + 1} for ${item.projectName}.`}
        confirmLabel="Approve"
        loading={approving}
        onConfirm={handleApprove}
        onCancel={() => setConfirmApprove(false)}
      />

      <ReworkModal
        open={showRework}
        onClose={() => setShowRework(false)}
        onConfirm={handleRework}
      />

      {latest && (
        <RecordDecisionModal
          open={showRecord}
          verifierName={nameOf(latest.verifierId)}
          onClose={() => setShowRecord(false)}
          onConfirm={handleRecord}
        />
      )}
    </div>
  );
}

export default function AdminReviews() {
  const t = useT();
  const [items, setItems] = useState<PendingStage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all stages with pending_review status (jalla_verify projects)
      // The nested profiles embed is dropped: projects -> profiles is not a
      // relationship PostgREST can infer (the FK targets auth.users), so the whole
      // query 400'd and no stage ever reached review. projects -> project_stages IS
      // a real FK, so that half of the embed is kept.
      const [{ data: stages }, owners] = await Promise.all([
        supabase
          .from('project_stages')
          .select(`
            id, stage_number, name, completed_at, verification_required,
            projects!inner(id, name, user_id, tier),
            project_substages(id, name, status, evidence_urls)
          `)
          .eq('status', 'pending_review')
          .order('stage_number'),
        ownerLookup(),
      ]);

      if (!stages) { setItems([]); return; }

      // The verification layer, per project, once each — fail-soft when 086/087 are not
      // applied (the queries return `available: false` and the card shows the queue as
      // it was before verification existed).
      const projectIds = [...new Set(stages.map((s: Record<string, unknown>) => (s.projects as Record<string, unknown>).id as string))];
      const layer = new Map<string, { verifications: StageVerification[]; verifiers: ProjectVerifier[]; available: boolean }>();
      await Promise.all(projectIds.map(async pid => {
        try {
          const [v, pv] = await Promise.all([listProjectVerifications(pid), listProjectVerifiers(pid)]);
          layer.set(pid, { verifications: v.rows, verifiers: pv.rows, available: v.available && pv.available });
        } catch {
          layer.set(pid, { verifications: [], verifiers: [], available: false });
        }
      }));

      const pending: PendingStage[] = stages.map((s: Record<string, unknown>) => {
        const proj = s.projects as Record<string, unknown>;
        const profile = owners.get(proj.user_id as string);
        const substages = (s.project_substages as Record<string, unknown>[]) ?? [];
        const l = layer.get(proj.id as string) ?? { verifications: [], verifiers: [], available: false };
        return {
          verificationRequired:  s.verification_required === true,
          verificationAvailable: l.available,
          latestVerification:    latestForStage(l.verifications, s.id as string),
          verifiers:             l.verifiers,
          stageId:     s.id as string,
          stageNumber: s.stage_number as number,
          stageName:   s.name as string,
          projectId:   proj.id as string,
          projectName: proj.name as string,
          ownerEmail:  profile?.email ?? '',
          ownerName:   profile?.name ?? '',
          submittedAt: s.completed_at as string | null,
          substages:   substages.map(sub => ({
            id:           sub.id as string,
            name:         sub.name as string,
            evidenceUrls: (sub.evidence_urls as string[]) ?? [],
            status:       sub.status as string,
          })),
        };
      });

      setItems(pending);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  function removeStage(stageId: string) {
    setItems(prev => prev.filter(i => i.stageId !== stageId));
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.reviewsTitle')}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          Jalla Verify stages awaiting your approval
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" />
          Loading pending reviews…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle2 className="size-10 text-state-complete" />
          <p className="text-sm font-medium text-brand-near-black">{t('admin.allCaughtUp')}</p>
          <p className="text-xs text-brand-mid-grey">{t('admin.reviewsEmpty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 max-w-2xl">
          {items.map(item => (
            <StageReviewCard
              key={item.stageId}
              item={item}
              onApproved={removeStage}
              onReworkRequested={removeStage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * An admin records a verifier's decision on their behalf (Phase 3 §8.1).
 *
 * The verifier stays the verifier of record; the admin is `recorded_by`; a reason is
 * mandatory — and the database refuses the call without it, so this form's validation is
 * a courtesy, not the control. Exists because the verifier's own screen arrives with the
 * Project Workspace (Phase 5); until then this is how a phone-call decision enters the
 * record without pretending the admin verified anything.
 */
function RecordDecisionModal({
  open, verifierName, onClose, onConfirm,
}: {
  open: boolean;
  verifierName: string;
  onClose: () => void;
  onConfirm: (input: { decision: Exclude<VerificationDecision, 'pending'>; findings: string; reason: string; visited: boolean }) => Promise<void>;
}) {
  const t = useT();
  const [decision, setDecision] = useState<Exclude<VerificationDecision, 'pending'>>('verified');
  const [findings, setFindings] = useState('');
  const [reason, setReason]     = useState('');
  const [visited, setVisited]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) { setError(t('admin.verification.errReason')); return; }
    // "Verified" means visited (087 CHECK). Said here so the person sees it before the
    // database says it; the database says it anyway.
    if (decision === 'verified' && !visited) { setError(t('admin.verification.errVisit')); return; }
    setBusy(true); setError(null);
    try {
      await onConfirm({ decision, findings: findings.trim(), reason: reason.trim(), visited });
      setFindings(''); setReason('');
    } catch (err) {
      const msg = errorMessage(err, '');
      setError(
        msg.includes('reason_required') ? t('admin.verification.errReason')
        : msg.includes('visit_required') ? t('admin.verification.errVisit')
        : msg || t('common.somethingWrong'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={busy ? undefined : onClose}
        >
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-brand-border-grey bg-white p-6"
          >
            <h2 className="text-sm font-bold text-brand-near-black">{t('admin.verification.recordTitle', { name: verifierName })}</h2>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.verification.recordBody')}</p>

            <label htmlFor="rd-decision" className="mt-4 block text-xs font-medium text-brand-near-black">{t('admin.verification.decision')}</label>
            <select
              id="rd-decision" value={decision}
              onChange={e => setDecision(e.target.value as Exclude<VerificationDecision, 'pending'>)}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
            >
              <option value="verified">{t('admin.verification.decisionVerified')}</option>
              <option value="rejected">{t('admin.verification.decisionRejected')}</option>
              <option value="needs_more_evidence">{t('admin.verification.decisionMore')}</option>
            </select>

            <label className="mt-3 flex items-center gap-2 text-xs text-brand-near-black">
              <input type="checkbox" checked={visited} onChange={e => setVisited(e.target.checked)} className="size-3.5 accent-[#0a0a0a]" />
              {t('admin.verification.visited')}
            </label>

            <label htmlFor="rd-findings" className="mt-3 block text-xs font-medium text-brand-near-black">{t('admin.verification.findingsLabel')}</label>
            <textarea
              id="rd-findings" value={findings} onChange={e => setFindings(e.target.value)} rows={3}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
            />

            <label htmlFor="rd-reason" className="mt-3 block text-xs font-medium text-brand-near-black">{t('admin.verification.reasonLabel')}</label>
            <input
              id="rd-reason" type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder={t('admin.verification.reasonPlaceholder')}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
            />

            {error && <p role="alert" className="mt-2 text-xs text-state-alert">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white disabled:opacity-40">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={submit} disabled={busy || !reason.trim()}
                className="flex-1 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40">
                {busy ? t('admin.verification.recording') : t('admin.verification.recordDecision')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
