import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '@/lib/i18n';

// Extracted from routes/admin/reviews.tsx unchanged (Phase 5 step 2), so the Project
// Workspace's Stages tab and the Stages & Reviews queue share one "request rework" dialog.
export function ReworkModal({
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
