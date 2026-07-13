import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, RotateCcw, Loader2, ImageIcon, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { adminApproveStage, adminRequestRework } from '@/lib/supabase/approvals';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

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
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
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
            <h3 className="text-base font-semibold text-brand-near-black mb-2">Request changes</h3>
            <p className="text-sm text-brand-mid-grey mb-4">
              Explain what needs to be corrected. The homeowner will be notified.
            </p>
            <textarea
              className="w-full h-28 rounded-xl border border-brand-border-grey px-3 py-2.5 text-sm text-brand-near-black resize-none outline-none focus:ring-2 focus:ring-brand-near-black/20"
              placeholder="Describe the required changes..."
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
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [approving, setApproving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showRework, setShowRework] = useState(false);

  async function handleApprove() {
    if (!user) return;
    setApproving(true);
    try {
      await adminApproveStage(item.projectId, item.stageId, item.stageNumber, user.id);
      onApproved(item.stageId);
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
            <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
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

      {/* Actions */}
      <div className="px-5 py-4 border-t border-brand-border-grey flex gap-3 justify-end">
        <button
          type="button"
          onClick={() => setShowRework(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-brand-border-grey rounded-xl text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <RotateCcw className="size-4" />
          Request changes
        </button>
        <button
          type="button"
          onClick={() => setConfirmApprove(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand-near-black text-white rounded-xl hover:bg-black transition-colors"
        >
          {approving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Approve stage
        </button>
      </div>

      <ConfirmModal
        open={confirmApprove}
        title="Approve this stage?"
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
    </div>
  );
}

export default function AdminReviews() {
  const [items, setItems] = useState<PendingStage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all stages with pending_review status (jalla_verify projects)
      const { data: stages } = await supabase
        .from('project_stages')
        .select(`
          id, stage_number, name, completed_at,
          projects!inner(id, name, user_id, tier,
            profiles!inner(full_name, email)
          ),
          project_substages(id, name, status, evidence_urls)
        `)
        .eq('status', 'pending_review')
        .order('stage_number');

      if (!stages) { setItems([]); return; }

      const pending: PendingStage[] = stages.map((s: Record<string, unknown>) => {
        const proj = s.projects as Record<string, unknown>;
        const profile = proj.profiles as Record<string, unknown>;
        const substages = (s.project_substages as Record<string, unknown>[]) ?? [];
        return {
          stageId:     s.id as string,
          stageNumber: s.stage_number as number,
          stageName:   s.name as string,
          projectId:   proj.id as string,
          projectName: proj.name as string,
          ownerEmail:  profile?.email as string ?? '',
          ownerName:   profile?.full_name as string ?? '',
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
        <h1 className="text-2xl font-bold text-brand-near-black">Stage Reviews</h1>
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
          <CheckCircle2 className="size-10 text-green-500" />
          <p className="text-sm font-medium text-brand-near-black">All caught up</p>
          <p className="text-xs text-brand-mid-grey">No stages are pending review right now.</p>
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
