import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { recordDecision, type Decision } from '@/lib/supabase/conversations';
import type { StageView } from '@/lib/admin/workspace';
import { errorMessage } from '@/lib/errors';
import { useStageLabels } from '@/lib/stage-labels';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Record a decision (091 `record_decision`), deliberately small.
//
// A DECISION IS NOT A MESSAGE. A message is what someone said; a decision is what the
// project will now do — immutable, dated, attributed, optionally traced to the message it
// came from. This dialog collects the eight fields the RPC takes and writes once; the
// row then appears from `ws.decisions` on the next read, never from local state.
//
// "Approved by the client" records the OWNER as `approved_by` — for an approval given
// on WhatsApp or by phone. It is never ticked by default.
// =========================================================

const RELATED: Decision['related'][] = ['budget', 'stage', 'design', 'payment', 'other'];

export function RecordDecisionModal({ projectId, ownerId, stages, conversationId, message, onClose, onRecorded }: {
  projectId: string;
  /** The project owner's account — the only person "approved by the client" can name. */
  ownerId: string | null;
  stages: StageView[];
  conversationId: string | null;
  /** The message this decision came from, when one was picked. */
  message: { id: string; senderName: string; content: string } | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [subject, setSubject]   = useState('');
  const [decision, setDecision] = useState('');
  const [related, setRelated]   = useState<Decision['related']>('other');
  const [stageId, setStageId]   = useState('');
  const [cost, setCost]         = useState('');
  const [days, setDays]         = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function submit() {
    if (!subject.trim() || !decision.trim()) { setError(t('admin.decision.errRequired')); return; }
    setBusy(true); setError(null);
    try {
      await recordDecision({
        projectId, subject: subject.trim(), decision: decision.trim(), related,
        relatedId: related === 'stage' && stageId ? stageId : undefined,
        conversationId: conversationId ?? undefined, messageId: message?.id,
        costImpactUsd: cost.trim() ? Number(cost) : undefined,
        scheduleImpactDays: days.trim() ? Number(days) : undefined,
        approvedBy: approved && ownerId ? ownerId : undefined,
      });
      onRecorded();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
      setBusy(false);
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white';
  const label = 'block text-xs font-semibold text-brand-near-black dark:text-white';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="flex items-start justify-between gap-3 border-b border-brand-border-grey px-6 py-4 dark:border-[#2c2c2c]">
          <div>
            <h2 className="text-base font-bold text-brand-near-black dark:text-white">{t('admin.decision.title')}</h2>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.decision.body')}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#252525]"><X className="size-4" /></button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          {message && (
            <blockquote className="rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-2 text-xs text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
              <span className="font-medium text-brand-near-black dark:text-white">{message.senderName}</span>: {message.content.slice(0, 240)}
            </blockquote>
          )}
          <div>
            <label htmlFor="dec-subject" className={label}>{t('admin.decision.subject')}</label>
            <input id="dec-subject" value={subject} onChange={e => setSubject(e.target.value)} className={field} maxLength={200} />
          </div>
          <div>
            <label htmlFor="dec-text" className={label}>{t('admin.decision.decision')}</label>
            <textarea id="dec-text" value={decision} onChange={e => setDecision(e.target.value)} rows={3} className={field} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dec-related" className={label}>{t('admin.decision.related')}</label>
              <select id="dec-related" value={related} onChange={e => setRelated(e.target.value as Decision['related'])} className={field}>
                {RELATED.map(r => <option key={r} value={r}>{t(`admin.decision.relatedKind.${r}` as TKey)}</option>)}
              </select>
            </div>
            {related === 'stage' && (
              <div>
                <label htmlFor="dec-stage" className={label}>{t('admin.decision.stage')}</label>
                <select id="dec-stage" value={stageId} onChange={e => setStageId(e.target.value)} className={field}>
                  <option value="">—</option>
                  {stages.map(s => <option key={s.stage.id} value={s.stage.id}>{s.stage.stage_number} · {stageLabel(s.stage)}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="dec-cost" className={label}>{t('admin.decision.cost')}</label>
              <input id="dec-cost" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value.replace(/[^0-9.-]/g, ''))} className={field} placeholder="0" />
            </div>
            <div>
              <label htmlFor="dec-days" className={label}>{t('admin.decision.days')}</label>
              <input id="dec-days" inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/[^0-9-]/g, ''))} className={field} placeholder="0" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-brand-near-black dark:text-white">
            <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} disabled={!ownerId} className="mt-0.5" />
            <span>{t('admin.decision.approvedByClient')}<span className="block text-[11px] text-brand-mid-grey">{t('admin.decision.approvedByClientHint')}</span></span>
          </label>
          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-brand-border-grey px-6 py-4 dark:border-[#2c2c2c]">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]">{t('common.cancel')}</button>
          <button type="button" onClick={submit} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy && <Loader2 className="size-3.5 animate-spin" />}{t('admin.decision.record')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
