import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Paperclip, Ruler, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  BOQ_ACCEPT_ATTR, FLOOR_PLAN_ACCEPT_ATTR, MAX_FILE_MB, fileProblem,
  isBoqFile, isFloorPlanFile,
} from '@/lib/documents/accepted-files';
import { extractBqTotal, extractFloorPlanFacts, canExtract, type FloorPlanFacts } from '@/lib/budget/extract-bq';
import { floorPlanSummary, floorPlanEvidence, modelReadingSummary } from '@/lib/budget/floor-plan-summary';
import { readPlanWithModel, mergeModelReading } from '@/lib/budget/model-plan-reading';
import type { BqLineItem, BqReading } from '@/lib/budget/read-bq-total';
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
  | {
      hasPlan: true;
      floorPlans: File[];
      bq: File | null;
      reading: BqReading | null;
      lineItems: BqLineItem[];
      floorPlanFacts: FloorPlanFacts[];
      /** A storey count the bill of quantities states, when the drawing did not. */
      bqStatedFloors: number | null;
    };

export function ArchitecturePlanGate({ onAnswered, onCancel, backLabel }: {
  onAnswered: (answer: PlanAnswer) => void;
  onCancel?: () => void;
  backLabel?: string;
}) {
  const t = useT();
  const [slide, setSlide] = useState<'ask' | 'upload'>('ask');
  const [selectedHasPlan, setSelectedHasPlan] = useState<boolean | null>(null);
  const [floorPlans, setFloorPlans] = useState<File[]>([]);
  const [bq, setBq] = useState<File | null>(null);
  const [reading, setReading] = useState<BqReading | null>(null);
  const [lineItems, setLineItems] = useState<BqLineItem[]>([]);
  const [bqStatedFloors, setBqStatedFloors] = useState<number | null>(null);
  const [floorPlanFacts, setFloorPlanFacts] = useState<FloorPlanFacts[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const scanning = scanCount > 0;
  const [unreadable, setUnreadable] = useState(false);
  // The second, slower read. Never gates Continue — see `inspectFloorPlans`.
  const [looking, setLooking] = useState(false);
  // Read from a picture rather than from the file. Said plainly wherever the figure
  // appears: OCR confuses 8 with 3 and 1 with 7, and this number becomes ten payments.
  const [fromOcr, setFromOcr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read the plans twice: off the text layer, then by looking at them.
   *
   * The two are deliberately not awaited together. The extractor is instant and local
   * and its answer is what the budget is built from, so it goes on screen the moment
   * it is ready. The model read is a network call that costs money and takes seconds,
   * and it arrives afterwards to fill in what counting could not — above all how many
   * separate dwellings the layout holds, which decides whether this is one build or
   * three and which no string on a drawing ever states.
   *
   * `looking` is tracked apart from `scanCount` on purpose. Continue must not wait on
   * it: the extractor has already produced everything the next step needs, and a
   * model that is slow, unconfigured or down cannot be allowed to hold up a project.
   */
  async function inspectFloorPlans(files: File[]) {
    setScanCount(count => count + 1);
    let facts: FloorPlanFacts[];
    try {
      facts = await Promise.all(files.map(file => extractFloorPlanFacts(file)));
      setFloorPlanFacts(facts);
    } finally {
      setScanCount(count => Math.max(0, count - 1));
    }

    setLooking(true);
    try {
      const readings = await Promise.all(files.map(file => readPlanWithModel(file)));
      if (readings.every(reading => reading == null)) return;
      setFloorPlanFacts(facts.map((fact, i) => mergeModelReading(fact, readings[i] ?? null)));
    } finally {
      setLooking(false);
    }
  }

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
    setScanCount(count => count + 1);
    try {
      const out = await extractBqTotal(file);
      setReading(out.reading);
      setLineItems(out.lineItems);
      setBqStatedFloors(out.statedFloors);
      setFromOcr(out.ocr);
      // Told apart on purpose: a file we could not read at all (a scanned PDF) is a
      // different thing to say than a file we read but found no total in.
      setUnreadable(!out.readable);
    } catch {
      setReading(null);
      setLineItems([]);
      setBqStatedFloors(null);
      setUnreadable(true);
    } finally {
      setScanCount(count => Math.max(0, count - 1));
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
            selected={selectedHasPlan === true}
            onClick={() => { setError(null); setSelectedHasPlan(true); }}
          />
          <Choice
            id="plan-no"
            title={t('planGate.no')} body={t('planGate.noBody')}
            selected={selectedHasPlan === false}
            onClick={() => { setError(null); setSelectedHasPlan(false); }}
          />
        </div>

        <div className="mt-7 flex items-center gap-4">
          {onCancel && (
            <button
              type="button" onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black"
            >
              <ArrowLeft className="size-3.5" aria-hidden />{backLabel ?? t('planGate.back')}
            </button>
          )}
          <motion.button
            type="button" whileTap={{ scale: 0.99 }}
            disabled={selectedHasPlan === null}
            onClick={() => {
              if (selectedHasPlan === true) setSlide('upload');
              else if (selectedHasPlan === false) onAnswered({ hasPlan: false });
            }}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {t('planGate.continue')}<ArrowRight className="size-4" aria-hidden />
          </motion.button>
        </div>
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
          files={floorPlans} multiple kind="floorPlan" accept={FLOOR_PLAN_ACCEPT_ATTR}
          onPick={files => {
            const chosen = Array.isArray(files) ? files : files ? [files] : [];
            setError(null);
            setFloorPlans(chosen);
            setFloorPlanFacts([]);
            if (chosen.length) void inspectFloorPlans(chosen);
          }}
          onError={setError}
        />
        <Drop
          label={t('planGate.bq')} hint={t('planGate.bqHint')}
          file={bq} busy={scanning} kind="boq" accept={BOQ_ACCEPT_ATTR}
          onPick={selection => {
            const file = Array.isArray(selection) ? selection[0] ?? null : selection;
            setError(null);
            setBq(file);
            if (file) void inspect(file);
            else { setReading(null); setLineItems([]); }
          }}
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
          {/* Only a scan gets a caution, because only a scan can misread a digit.
              A clean read needs no paragraph — the figure is confirmed again on the
              summary step either way, so saying so here was noise. */}
          {fromOcr && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
              {t('planGate.checkScanned')}
            </p>
          )}
        </div>
      )}
      {scanning && (
        <p role="status" className="mt-4 flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />{t('planGate.reading')}
        </p>
      )}
      {looking && !scanning && (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />{t('planGate.lookingAtPlan')}
        </p>
      )}
      {bq && !reading && !scanning && (
        <p className="mt-4 rounded-xl bg-brand-off-white px-4 py-3 text-xs leading-relaxed text-brand-mid-grey">
          {t(unreadable ? 'planGate.couldNotRead' : 'planGate.noTotalFound')}
        </p>
      )}
      {floorPlans.length > 0 && !scanning && (
        <div className="mt-3 rounded-xl bg-brand-off-white px-4 py-3 text-xs leading-relaxed text-brand-mid-grey">
          {floorPlanFacts.map((facts, i) => (
            <div key={`${floorPlans[i]?.name ?? 'plan'}-${i}`} className="mb-2 last:mb-0">
              <p className="font-medium text-brand-near-black">{floorPlans[i]?.name}</p>
              <p>{floorPlanSummary(facts, t)}</p>
              {floorPlanEvidence(facts) && (
                <p className="mt-1 truncate font-mono text-[10px]" title={floorPlanEvidence(facts) ?? undefined}>
                  {floorPlanEvidence(facts)}
                </p>
              )}
              {/* Under its own heading, never merged into the line above: that line is
                  counted off the sheet, this one is a reading of the picture. */}
              {modelReadingSummary(facts, t) && (
                <div className="mt-2 border-t border-brand-border-grey/60 pt-2">
                  <p className="font-medium text-brand-near-black">{t('planGate.modelReadTitle')}</p>
                  <p>{modelReadingSummary(facts, t)}</p>
                  {facts.model?.basis.dwellingUnits && (
                    <p className="mt-1 text-[11px] italic">{facts.model.basis.dwellingUnits}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {bq && lineItems.length === 0 && !scanning && (
        <p className="mt-2 text-xs text-brand-mid-grey">
          {t('planGate.noLineItems')}
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
          disabled={!floorPlans.length || !bq || scanning}
          onClick={() => onAnswered({
            hasPlan: true, floorPlans, bq, reading, lineItems, floorPlanFacts, bqStatedFloors,
          })}
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

function Choice({ id, title, body, selected, onClick }: {
  id: string; title: string; body: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      id={id} type="button" onClick={onClick} aria-pressed={selected}
      className={cn(
        'group rounded-2xl border border-brand-border-grey bg-white p-5 text-left transition-colors hover:border-brand-near-black',
        selected && 'border-brand-near-black bg-brand-off-white',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-brand-near-black">{title}</span>
        <ArrowRight className="size-4 shrink-0 text-brand-mid-grey transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-brand-mid-grey">{body}</span>
    </button>
  );
}

function Drop({ label, hint, file, files = [], multiple = false, kind, accept, busy, onPick, onError }: {
  label: string; hint: string; file?: File | null; files?: File[]; multiple?: boolean; busy?: boolean;
  kind: 'floorPlan' | 'boq'; accept: string;
  onPick: (f: File | File[] | null) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const selectedFiles = multiple ? files : file ? [file] : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border-grey p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-near-black">{label}</p>
        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
          {selectedFiles.length
            ? <span className="inline-flex items-center gap-1 text-state-success"><Check className="size-3" aria-hidden />{selectedFiles.map(f => f.name).join(', ')}</span>
            : hint}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {selectedFiles.length > 0 && (
          <button
            type="button" onClick={() => { onPick(multiple ? [] : null); if (ref.current) ref.current.value = ''; }}
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
          {multiple && selectedFiles.length
            ? t('planGate.addMore')
            : selectedFiles.length
              ? t('planGate.replace')
              : t('planGate.choose')}
        </button>
      </div>
      <input
        ref={ref} type="file" className="sr-only" accept={accept} multiple={multiple}
        onChange={e => {
          const pickedFiles = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!pickedFiles.length) return;
          // The same size and type rules the rest of the product applies, so a file
          // accepted here cannot be refused by storage a moment later.
          for (const picked of pickedFiles) {
            const generalProblem = fileProblem(picked);
            const roleProblem = kind === 'boq'
              ? isBoqFile(picked) ? null : 'type'
              : isFloorPlanFile(picked) ? null : 'type';
            const problem = generalProblem ?? roleProblem;
            if (problem) {
              onError(t(problem === 'size' ? 'wizard.confirmBudget.quoteTooLarge'
                                           : 'wizard.confirmBudget.quoteBadType', { mb: MAX_FILE_MB }));
              return;
            }
          }
          if (multiple) {
            const merged = [...selectedFiles, ...pickedFiles]
              .filter((candidate, index, all) =>
                index === all.findIndex(file =>
                  file.name === candidate.name
                  && file.size === candidate.size
                  && file.lastModified === candidate.lastModified,
                ));
            onPick(merged);
            return;
          }
          onPick(pickedFiles[0]);
        }}
      />
    </div>
  );
}
