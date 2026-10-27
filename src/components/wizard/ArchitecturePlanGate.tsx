import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Paperclip, Ruler, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { FILE_ACCEPT_ATTR, MAX_FILE_MB, fileProblem } from '@/lib/documents/accepted-files';
import { extractBqTotal, canExtract } from '@/lib/budget/extract-bq';
import type { BqReading } from '@/lib/budget/read-bq-total';
import { cn } from '@/lib/utils';

// =========================================================
// "Does your project have an architecture plan?"
//
// Asked BEFORE the wizard, and the same question in the same words whether a client is
// setting up their own project or a partner contractor is doing it for them.
//
// ── Why it comes first ──────────────────────────────────────────────────────────────
// It is the document everything else depends on. Somebody with drawings and a priced
// bill of quantities has nothing to estimate — the BQ is the budget. Somebody without
// them has nothing to upload, and asking for a BQ at the end of an eleven-step form
// they were never going to fill is asking twice.
//
// ── Why it sits outside the wizard rather than inside it ────────────────────────────
// The wizard steps are hardcoded by number in the progress bar, the building
// preview and the shell. Inserting steps at the front would renumber all of them.
// Asking before it starts also matches what the branch actually is: a question about
// which flow you belong in, not a step within one.
// =========================================================

export type PlanAnswer =
  | { hasPlan: false }
  | { hasPlan: true; floorPlan: File | null; bq: File | null; reading: BqReading | null };

export function ArchitecturePlanGate({ onAnswered, onCancel, backLabel }: {
  onAnswered: (answer: PlanAnswer) => void;
  onCancel?: () => void;
  backLabel?: string;
}) {
  const t = useT();
  const [slide, setSlide] = useState<'ask' | 'upload'>('ask');
  const [floorPlan, setFloorPlan] = useState<File | null>(null);
  const [bq, setBq] = useState<File | null>(null);
  const [reading, setReading] = useState<BqReading | null>(null);
  const [scanning, setScanning] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  // Read from a picture rather than from the file. Said plainly wherever the figure
  // appears: OCR confuses 8 with 3 and 1 with 7, and this number becomes ten payments.
  const [fromOcr, setFromOcr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Try to read a construction total out of the BQ as soon as it is picked.
   *
   * Only for the delimited formats `readBqTotal` genuinely handles. The figure is a
   * SUGGESTION — it is shown back with the row it came from, and confirmed later
   * against the budget, because it becomes ten stage payments.
   */
  async function inspect(file: File) {
    setReading(null);
    setUnreadable(false);
    setFromOcr(false);
    if (!canExtract(file.name)) { setUnreadable(true); return; }
    setScanning(true);
    try {
      const out = await extractBqTotal(file);
      setReading(out.reading);
      setFromOcr(out.ocr);
      // Told apart on purpose: a file we could not read at all (a scanned PDF) is a
      // different thing to say than a file we read but found no total in.
      setUnreadable(!out.readable);
    } catch {
      setReading(null);
      setUnreadable(true);
    } finally {
      setScanning(false);
    }
  }

  if (slide === 'ask') {
    return (
      <Slide>
        <div className="mb-6">
          <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full bg-brand-off-white">
            <Ruler className="size-5 text-brand-near-black" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold leading-snug text-brand-near-black sm:text-3xl">
            {t('planGate.question')}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-brand-mid-grey">
            {t('planGate.questionBody')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            id="plan-yes"
            title={t('planGate.yes')} body={t('planGate.yesBody')}
            onClick={() => { setError(null); setSlide('upload'); }}
          />
          <Choice
            id="plan-no"
            title={t('planGate.no')} body={t('planGate.noBody')}
            onClick={() => onAnswered({ hasPlan: false })}
          />
        </div>

        {onCancel && (
          <button
            type="button" onClick={onCancel}
            className="mt-7 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black"
          >
            <ArrowLeft className="size-3.5" aria-hidden />{backLabel ?? t('planGate.back')}
          </button>
        )}
      </Slide>
    );
  }

  return (
    <Slide>
      <div className="mb-6">
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full bg-brand-off-white">
          <Paperclip className="size-5 text-brand-near-black" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold leading-snug text-brand-near-black sm:text-3xl">
          {t('planGate.uploadTitle')}
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-brand-mid-grey">
          {t('planGate.uploadBody')}
        </p>
      </div>

      <div className="space-y-3">
        <Drop
          label={t('planGate.floorPlan')} hint={t('planGate.floorPlanHint')}
          file={floorPlan}
          onPick={f => { setError(null); setFloorPlan(f); }}
          onError={setError}
        />
        <Drop
          label={t('planGate.bq')} hint={t('planGate.bqHint')}
          file={bq} busy={scanning}
          onPick={f => { setError(null); setBq(f); if (f) void inspect(f); else setReading(null); }}
          onError={setError}
        />
      </div>

      {/* What we think the BQ says. Shown with the row it came from, so it can be
          checked at a glance — and it is confirmed again against the budget before
          anything is created. */}
      {reading && (
        <div className="mt-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3">
          <p className="text-xs font-semibold text-brand-near-black">
            {t(fromOcr ? 'planGate.scannedTotal'
              : reading.confidence === 'grand' ? 'planGate.readTotal'
              : 'planGate.guessedTotal')}
          </p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-brand-near-black">
            {reading.total.toLocaleString()}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-brand-mid-grey" title={reading.label}>
            {reading.label}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
            {t(fromOcr ? 'planGate.checkScanned' : 'planGate.confirmLater')}
          </p>
        </div>
      )}
      {scanning && (
        <p role="status" className="mt-4 flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />{t('planGate.reading')}
        </p>
      )}
      {bq && !reading && !scanning && (
        <p className="mt-4 rounded-xl bg-brand-off-white px-4 py-3 text-xs leading-relaxed text-brand-mid-grey">
          {t(unreadable ? 'planGate.couldNotRead' : 'planGate.noTotalFound')}
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}

      <div className="mt-7 flex items-center gap-4">
        <button
          type="button" onClick={() => { setError(null); setSlide('ask'); }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black"
        >
          <ArrowLeft className="size-3.5" aria-hidden />{t('planGate.back')}
        </button>
        <motion.button
          type="button" whileTap={{ scale: 0.99 }}
          // Both documents are the point of this path, so both are required. Somebody
          // who cannot produce them belongs on the other branch, and the Back button
          // above is how they get there.
          disabled={!floorPlan || !bq || scanning}
          onClick={() => onAnswered({ hasPlan: true, floorPlan, bq, reading })}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {scanning && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('planGate.continue')}<ArrowRight className="size-4" aria-hidden />
        </motion.button>
      </div>
    </Slide>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="mx-auto w-full max-w-2xl px-6 py-10 sm:px-10 sm:py-14"
    >
      {children}
    </motion.div>
  );
}

function Choice({ id, title, body, onClick }: {
  id: string; title: string; body: string; onClick: () => void;
}) {
  return (
    <button
      id={id} type="button" onClick={onClick}
      className="group rounded-2xl border border-brand-border-grey bg-white p-5 text-left transition-colors hover:border-brand-near-black"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-brand-near-black">{title}</span>
        <ArrowRight className="size-4 shrink-0 text-brand-mid-grey transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-brand-mid-grey">{body}</span>
    </button>
  );
}

function Drop({ label, hint, file, busy, onPick, onError }: {
  label: string; hint: string; file: File | null; busy?: boolean;
  onPick: (f: File | null) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border-grey p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-near-black">{label}</p>
        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
          {file
            ? <span className="inline-flex items-center gap-1 text-state-success"><Check className="size-3" aria-hidden />{file.name}</span>
            : hint}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {file && (
          <button
            type="button" onClick={() => { onPick(null); if (ref.current) ref.current.value = ''; }}
            aria-label={t('planGate.remove')}
            className="rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button" onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3.5 py-2 text-xs font-semibold text-brand-near-black"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
          {file ? t('planGate.replace') : t('planGate.choose')}
        </button>
      </div>
      <input
        ref={ref} type="file" className="sr-only" accept={FILE_ACCEPT_ATTR}
        onChange={e => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (!picked) return;
          // The same size and type rules the rest of the product applies, so a file
          // accepted here cannot be refused by storage a moment later.
          const problem = fileProblem(picked);
          if (problem) {
            onError(t(problem === 'size' ? 'wizard.confirmBudget.quoteTooLarge'
                                         : 'wizard.confirmBudget.quoteBadType', { mb: MAX_FILE_MB }));
            return;
          }
          onPick(picked);
        }}
      />
    </div>
  );
}
