import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './button';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  variant?: 'default' | 'client';
  eyebrow?: string;
  /** Structured review content; the frozen description remains available to callers. */
  children?: ReactNode;
  summary?: string;
}

export function ConfirmModal({
  open, title, description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  error,
  onConfirm, onCancel, variant = 'default', eyebrow, children, summary,
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
            className={cn('relative w-full rounded-2xl bg-white shadow-xl', variant === 'client' ? 'flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden border border-brand-border-grey' : 'max-w-sm p-6')}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={variant === 'client' ? 'shrink-0 border-b border-brand-border-grey px-5 py-5 sm:px-7 sm:py-6' : undefined}>
              {eyebrow && <p className="mb-2 break-words pr-8 text-xs text-brand-mid-grey">{eyebrow}</p>}
              <h2 className={variant === 'client' ? 'pr-8 text-xl font-bold tracking-tight text-brand-near-black sm:text-2xl' : 'mb-2 text-sm font-bold text-brand-near-black'}>{title}</h2>
              {variant === 'client' && <button type="button" aria-label={cancelLabel} onClick={onCancel} disabled={loading} className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white disabled:opacity-40"><X className="size-5" aria-hidden /></button>}
            </div>
            <div className={variant === 'client' ? 'min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7' : undefined}>
              {children}
              <p className={cn('whitespace-pre-line leading-relaxed text-brand-mid-grey', variant === 'client' ? 'text-sm' : 'mb-6 text-xs')}>{summary ?? description}</p>
              {error && <p role="alert" className={variant === 'client' ? 'text-sm text-state-alert' : 'mb-4 text-xs text-state-alert'}>{error}</p>}
            </div>

            <div className={cn('flex flex-col-reverse gap-2 sm:flex-row', variant === 'client' && 'shrink-0 border-t border-brand-border-grey px-5 py-4 sm:px-7')}>
              <Button
                type="button"
                variant="outline"
                className={cn('flex-1 text-sm', variant === 'client' && 'min-h-11 whitespace-normal')}
                onClick={onCancel}
                disabled={loading}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                className={cn('flex-1 text-sm', variant === 'client' && 'min-h-11 whitespace-normal', destructive ? 'bg-state-alert hover:bg-state-alert' : variant === 'client' ? 'bg-brand-green text-white hover:bg-brand-green-hover' : '')}
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
