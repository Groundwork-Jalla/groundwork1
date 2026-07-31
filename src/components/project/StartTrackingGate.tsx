import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardCheck, Upload, ArrowRight, Loader2, FileText,
  TrendingUp, TrendingDown, Info, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUSDFull } from '@/lib/budget';
import { uploadDocument } from '@/lib/supabase/documents';
import { startProjectTracking } from '@/lib/supabase/tracking';
import type { ProjectRow } from '@/types/project';

export default function StartTrackingGate({ project, userId, onStarted }: {
  project: ProjectRow;
  userId: string;
  onStarted: () => void;
}) {
  const estimate = project.budget_usd ?? 0;

  const [rawValue,   setRawValue]   = useState(String(Math.round(estimate)));
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const finalBudget = Math.max(0, Math.round(Number(rawValue.replace(/[^0-9.]/g, '')) || 0));
  const diff        = finalBudget - estimate;
  const diffPct     = estimate > 0 ? (diff / estimate) * 100 : 0;
  const changed     = Math.abs(diff) >= 1;
  const up          = diff > 0;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadDocument(project.id, userId, file, undefined, 'contract');
      setUploadedName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (finalBudget <= 0) { setError('Enter a valid budget amount.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await startProjectTracking(project.id, finalBudget);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start tracking.');
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="max-w-2xl mx-auto"
    >
      <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] overflow-hidden">
        {/* Header */}
        <div className="px-6 sm:px-8 py-6 border-b border-brand-border-grey dark:border-[#2c2c2c]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white dark:bg-[#252525]">
              <ClipboardCheck className="size-5 text-brand-near-black dark:text-white" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-brand-near-black dark:text-white leading-snug">
                Confirm your budget to start tracking
              </h2>
              <p className="text-sm text-brand-mid-grey mt-1 leading-relaxed">
                Your wizard estimate is a planning figure. Once you've spoken to your contractor,
                enter the final budget you've agreed on — every stage payment is calculated from it.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 sm:px-8 py-6 space-y-6">
          {/* Wizard estimate (read-only) */}
          <div className="flex items-center justify-between gap-4 rounded-xl bg-brand-off-white dark:bg-[#252525] px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold text-brand-mid-grey uppercase tracking-wide">Wizard estimate</p>
              <p className="text-xs text-brand-mid-grey mt-0.5">Auto-calculated from your build details</p>
            </div>
            <p className="text-lg font-bold tabular-nums text-brand-near-black dark:text-white shrink-0">
              {estimate > 0 ? formatUSDFull(estimate) : '—'}
            </p>
          </div>

          {/* Final budget input */}
          <div>
            <label htmlFor="final-budget" className="block text-sm font-semibold text-brand-near-black dark:text-white mb-2">
              Your final budget
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-mid-grey">$</span>
              <input
                id="final-budget"
                inputMode="numeric"
                value={rawValue === '0' ? '' : Number(rawValue.replace(/[^0-9.]/g, '') || 0).toLocaleString('en-US')}
                onChange={(e) => setRawValue(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#171717] pl-9 pr-4 py-3 text-lg font-bold tabular-nums text-brand-near-black dark:text-white focus:outline-none focus:border-brand-near-black dark:focus:border-white transition-colors"
              />
            </div>
          </div>

          {/* Side-by-side comparison (only when it differs) */}
          {changed && estimate > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-3">
                  <p className="text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">Estimate</p>
                  <p className="text-base font-bold tabular-nums text-brand-mid-grey mt-1 line-through">{formatUSDFull(estimate)}</p>
                </div>
                <div className="rounded-xl border-2 border-brand-near-black dark:border-white px-4 py-3">
                  <p className="text-[10px] font-semibold text-brand-near-black dark:text-white uppercase tracking-wide">Final budget</p>
                  <p className="text-base font-bold tabular-nums text-brand-near-black dark:text-white mt-1">{formatUSDFull(finalBudget)}</p>
                </div>
              </div>
              <div className={cn(
                'mt-3 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium',
                up ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                   : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400',
              )}>
                {up ? <TrendingUp className="size-3.5 shrink-0" /> : <TrendingDown className="size-3.5 shrink-0" />}
                {up ? 'Higher than estimate by' : 'Lower than estimate by'}{' '}
                <span className="font-bold tabular-nums">{formatUSDFull(Math.abs(diff))}</span>
                <span className="tabular-nums">({up ? '+' : '−'}{Math.abs(diffPct).toFixed(1)}%)</span>
              </div>
            </motion.div>
          )}

          {/* Optional quote upload */}
          <div>
            <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">
              Contractor quote <span className="text-brand-mid-grey font-normal">(optional)</span>
            </p>
            <p className="text-xs text-brand-mid-grey mb-2.5">Keep a copy on file — stored in your documents.</p>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} className="hidden" />
            {uploadedName ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/30 px-4 py-2.5">
                <Check className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                <span className="text-xs text-green-700 dark:text-green-400 font-medium truncate flex-1">{uploadedName}</span>
                <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-green-700 dark:text-green-400 underline shrink-0">Replace</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] px-4 py-3 text-xs font-medium text-brand-mid-grey hover:border-brand-near-black dark:hover:border-white hover:text-brand-near-black dark:hover:text-white transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {uploading ? 'Uploading…' : 'Upload quote (PDF or image)'}
              </button>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <Info className="size-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-5 border-t border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white/40 dark:bg-[#171717] flex items-center justify-between gap-4">
          <p className="text-[11px] text-brand-mid-grey leading-snug max-w-xs">
            Confirming activates Stage 1 and locks in your payment schedule. You can still upload evidence per stage as you go.
          </p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || finalBudget <= 0}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-semibold px-5 py-3 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {submitting ? 'Starting…' : 'Confirm & Start Tracking'}
            {!submitting && <ArrowRight className="size-3.5" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
