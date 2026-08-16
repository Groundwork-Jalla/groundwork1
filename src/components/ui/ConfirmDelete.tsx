import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// =========================================================
// One confirmation for every admin delete.
//
// These are permanent and there is no undo, so the dialog states what is being removed
// by name rather than asking "are you sure?" about nothing in particular. `consequence`
// carries the part people do not expect — deleting an account takes its projects with
// it, because projects.user_id is ON DELETE CASCADE.
//
// The button stays disabled until the consequence has been acknowledged when there is
// one, so a destructive click cannot be muscle memory.
// =========================================================

export function ConfirmDelete({
  open, subject, consequence, busy, error, onConfirm, onCancel,
}: {
  open: boolean;
  /** What is being deleted, in the admin's words — an email, a name. */
  subject: string;
  /** Extra damage beyond the row itself. Omit when there is none. */
  consequence?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [acknowledged, setAcknowledged] = useState(false);
  const needsAck = Boolean(consequence);

  function close() {
    setAcknowledged(false);
    onCancel();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={busy ? undefined : close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            role="alertdialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl border border-brand-border-grey bg-white p-6"
          >
            <button
              type="button" onClick={close} disabled={busy}
              aria-label={t('common.cancel')}
              className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white disabled:opacity-40"
            >
              <X className="size-4" />
            </button>

            <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-brand-off-white">
              <AlertTriangle className="size-4 text-state-alert" />
            </div>

            <h2 className="text-lg font-bold text-brand-near-black">{t('admin.del.title')}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-mid-grey">
              {t('admin.del.body')}{' '}
              <span className="font-semibold text-brand-near-black">{subject}</span>
            </p>

            {consequence && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-state-alert/30 bg-brand-off-white px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={e => setAcknowledged(e.target.checked)}
                  className="mt-0.5 size-3.5 shrink-0 accent-[#0a0a0a]"
                />
                <span className="text-xs leading-relaxed text-brand-near-black">{consequence}</span>
              </label>
            )}

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-state-alert/30 px-3.5 py-2.5 text-sm text-state-alert">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button" onClick={close} disabled={busy}
                className="rounded-xl border border-brand-border-grey px-4 py-2.5 text-sm font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || (needsAck && !acknowledged)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity',
                  'bg-state-alert hover:opacity-90 disabled:opacity-40',
                )}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {busy ? t('common.loading') : t('admin.del.confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
