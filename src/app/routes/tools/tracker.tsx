import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronDown, ChevronUp, Printer, RotateCcw } from 'lucide-react';
import { getStageSeed } from '@/lib/supabase/stage-seeds';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'gw_tracker';
const STAGES = getStageSeed('residential', 'single_family', 1);
const ALL_SUBSTAGES = STAGES.flatMap(s => s.substages.map(sub => ({ stage: s.stage_number, sub })));
const TOTAL_SUBSTAGES = ALL_SUBSTAGES.length;

interface TrackerState {
  projectName: string;
  startDate: string;
  notes: Record<number, string>; // stageNumber → notes
  checked: Record<string, boolean>; // `${stageNumber}-${substageIndex}` → boolean
}

function defaultState(): TrackerState {
  return {
    projectName: '',
    startDate: new Date().toISOString().slice(0, 10),
    notes: {},
    checked: {},
  };
}

function load(): TrackerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {}
  return defaultState();
}

function save(state: TrackerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export default function TrackerTool() {
  const [state, setState] = useState<TrackerState>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [openStage, setOpenStage] = useState<number | null>(1);

  // Hydrate from localStorage client-side only
  useEffect(() => {
    setState(load());
    setLoaded(true);
  }, []);

  // Persist on every change
  useEffect(() => {
    if (loaded) save(state);
  }, [state, loaded]);

  const totalChecked = Object.values(state.checked).filter(Boolean).length;
  const progressPct = TOTAL_SUBSTAGES > 0 ? Math.round((totalChecked / TOTAL_SUBSTAGES) * 100) : 0;

  const checkedForStage = useCallback((stageNum: number) =>
    STAGES.find(s => s.stage_number === stageNum)?.substages.filter(
      (_, i) => state.checked[`${stageNum}-${i}`],
    ).length ?? 0,
    [state.checked],
  );

  function toggle(stageNum: number, subIdx: number) {
    const key = `${stageNum}-${subIdx}`;
    setState(prev => ({ ...prev, checked: { ...prev.checked, [key]: !prev.checked[key] } }));
  }

  function setNote(stageNum: number, value: string) {
    setState(prev => ({ ...prev, notes: { ...prev.notes, [stageNum]: value } }));
  }

  function reset() {
    if (window.confirm('Reset all progress? This cannot be undone.')) {
      setState(defaultState());
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 print:px-0 print:py-4">
      {/* Non-print header */}
      <div className="print:hidden">
        <Link to="/tools" className="inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white mb-8 transition-colors">
          <ChevronLeft className="size-3.5" /> Back to Tools
        </Link>

        <h1 className="text-2xl sm:text-3xl font-black text-brand-near-black dark:text-white mb-2">DIY Project Tracker</h1>
        <p className="text-sm text-brand-mid-grey mb-8">
          Check off substages as you go. Progress saves automatically in your browser — no account needed.
        </p>

        {/* Project meta */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div>
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-1.5 uppercase tracking-wide">Project Name</label>
            <input
              type="text"
              value={state.projectName}
              onChange={e => setState(prev => ({ ...prev, projectName: e.target.value }))}
              placeholder="My House Build"
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] text-sm text-brand-near-black dark:text-white px-3 py-2.5 placeholder:text-brand-border-grey focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-1.5 uppercase tracking-wide">Start Date</label>
            <input
              type="date"
              value={state.startDate}
              onChange={e => setState(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] text-sm text-brand-near-black dark:text-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white"
            />
          </div>
        </div>

        {/* Progress summary */}
        <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {totalChecked} of {TOTAL_SUBSTAGES} substages complete
            </p>
            <span className="text-sm font-black text-brand-near-black dark:text-white tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
            <div
              className="h-full bg-brand-near-black dark:bg-white rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-brand-mid-grey mt-2">
            {state.projectName ? `"${state.projectName}"` : 'Your project'} · started {state.startDate || '—'}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-8">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2 text-xs font-medium text-brand-near-black dark:text-white hover:bg-brand-off-white dark:hover:bg-[#282828] transition-colors"
          >
            <Printer className="size-3.5" /> Export Report
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2 text-xs font-medium text-brand-mid-grey hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 transition-colors"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <p className="text-lg font-black">{state.projectName || 'Project Tracker'} — Progress Report</p>
        <p className="text-sm text-gray-500">Started: {state.startDate} · {progressPct}% complete ({totalChecked}/{TOTAL_SUBSTAGES} substages)</p>
      </div>

      {/* Stage accordion */}
      <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c] rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden bg-white dark:bg-[#1e1e1e] print:rounded-none print:border-gray-200">
        {STAGES.map((stage) => {
          const doneCount = checkedForStage(stage.stage_number);
          const stageTotal = stage.substages.length;
          const stagePct = Math.round((doneCount / stageTotal) * 100);
          const isOpen = openStage === stage.stage_number;
          const isComplete = doneCount === stageTotal;

          return (
            <div key={stage.stage_number}>
              <button
                type="button"
                onClick={() => setOpenStage(isOpen ? null : stage.stage_number)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-brand-off-white dark:hover:bg-[#282828] transition-colors print:hidden"
              >
                <span className={cn(
                  'size-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold',
                  isComplete
                    ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                    : isOpen
                      ? 'border-2 border-brand-near-black dark:border-white text-brand-near-black dark:text-white'
                      : 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-mid-grey',
                )}>
                  {stage.stage_number}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white">{stage.name}</p>
                  <p className="text-[10px] text-brand-mid-grey mt-0.5">{doneCount}/{stageTotal} done</p>
                </div>

                {/* Mini progress */}
                <div className="hidden sm:block w-20 h-1 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden shrink-0">
                  <div className="h-full bg-brand-near-black dark:bg-white rounded-full transition-all duration-300" style={{ width: `${stagePct}%` }} />
                </div>

                <span className="text-xs font-semibold tabular-nums text-brand-mid-grey w-8 text-right">{stagePct}%</span>
                {isOpen ? <ChevronUp className="size-4 text-brand-mid-grey shrink-0" /> : <ChevronDown className="size-4 text-brand-mid-grey shrink-0" />}
              </button>

              {/* Print-visible stage header */}
              <div className="hidden print:flex items-center gap-3 px-4 py-2 bg-gray-100">
                <span className="text-sm font-bold">{stage.stage_number}. {stage.name}</span>
                <span className="text-xs text-gray-500">({doneCount}/{stageTotal} done)</span>
              </div>

              {/* Substages — visible when open (interactive) or always for print */}
              <div className={cn('print:block', isOpen ? 'block' : 'hidden')}>
                <div className="px-5 py-4 bg-brand-off-white dark:bg-[#1a1a1a] print:bg-white print:px-4">
                  <div className="flex flex-col gap-2 mb-4">
                    {stage.substages.map((sub, i) => {
                      const key = `${stage.stage_number}-${i}`;
                      const checked = !!state.checked[key];
                      return (
                        <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(stage.stage_number, i)}
                            className="mt-0.5 size-4 rounded border-brand-border-grey dark:border-[#555] accent-brand-near-black dark:accent-white shrink-0"
                          />
                          <span className={cn(
                            'text-sm transition-colors',
                            checked
                              ? 'line-through text-brand-mid-grey'
                              : 'text-brand-near-black dark:text-white',
                          )}>
                            {sub}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="print:hidden">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-1.5">Notes</label>
                    <textarea
                      value={state.notes[stage.stage_number] ?? ''}
                      onChange={e => setNote(stage.stage_number, e.target.value)}
                      placeholder="Add notes about this stage…"
                      rows={2}
                      className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-xs text-brand-near-black dark:text-white px-3 py-2 placeholder:text-brand-border-grey focus:outline-none focus:ring-1 focus:ring-brand-near-black dark:focus:ring-white resize-none"
                    />
                  </div>

                  {/* Print notes */}
                  {state.notes[stage.stage_number] && (
                    <div className="hidden print:block mt-2">
                      <p className="text-xs font-semibold text-gray-500">Notes:</p>
                      <p className="text-xs text-gray-700">{state.notes[stage.stage_number]}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="mt-10 print:hidden rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <p className="text-xs text-brand-mid-grey">
          <span className="font-semibold text-brand-near-black dark:text-white">Managing a real project?</span> Get stage sign-offs, document storage, contractor coordination, and payment tracking with a full Groundwork account.
        </p>
        <Link to="/auth/signup" className="shrink-0 inline-flex rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
          Get started free
        </Link>
      </div>
    </div>
  );
}
