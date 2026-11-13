import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open, title, description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  error,
  onConfirm, onCancel,
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            onClick={()=>{if(!loading)onCancel();}}
          />

          {/* Panel */}
          <motion.div
            role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
            ref={(node:HTMLDivElement|null)=>{node?.focus();}}
            onKeyDown={event=>{if(event.key==='Escape'&&!loading)onCancel();if(event.key==='Tab'){const controls=event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)');const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}
            className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="text-sm font-bold text-brand-near-black mb-2">{title}</h2>
            <p className="whitespace-pre-line text-xs text-brand-mid-grey leading-relaxed mb-6">{description}</p>
            {error && <p role="alert" className="mb-4 text-xs text-state-alert">{error}</p>}

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-sm"
                onClick={onCancel}
                disabled={loading}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                className={`flex-1 text-sm ${destructive ? 'bg-state-alert hover:bg-state-alert' : ''}`}
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? 'Please wait…' : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
