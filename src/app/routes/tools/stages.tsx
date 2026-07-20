import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { getStageSeed } from '@/lib/supabase/stage-seeds';
import { cn } from '@/lib/utils';

const STAGE_DAYS = [14, 21, 7, 14, 70, 14, 14, 21, 14, 7];
const PAYMENT_NOTE = [
  'Pay before work begins',
  'Pay on foundation completion',
  'Pay on wall completion',
  'Pay on decking completion',
  'Pay on roof completion',
  'Pay on plastering completion',
  'Pay on MEP first-fix sign-off',
  'Pay on finishing completion',
  'Pay on external works sign-off',
  'Pay on handover',
];

export default function StagesTool() {
  const stages = getStageSeed('residential', 'single_family', 1);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link to="/tools" className="inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white mb-8 transition-colors">
        <ChevronLeft className="size-3.5" /> Back to Tools
      </Link>

      <h1 className="text-2xl sm:text-3xl font-black text-brand-near-black dark:text-white mb-2">Construction Stage Planner</h1>
      <p className="text-sm text-brand-mid-grey mb-10">
        The standard 10-stage pipeline for residential construction. Click a stage to see substages and payment guidance.
      </p>

      {/* Summary bar */}
      <div className="flex gap-1 mb-8 h-3 rounded-full overflow-hidden">
        {stages.map(s => (
          <div
            key={s.stage_number}
            title={`Stage ${s.stage_number}: ${s.budget_pct}%`}
            className="bg-brand-near-black dark:bg-white opacity-60 hover:opacity-100 transition-opacity"
            style={{ width: `${s.budget_pct}%` }}
          />
        ))}
      </div>

      {/* Accordion list */}
      <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c] rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden bg-white dark:bg-[#1e1e1e]">
        {stages.map((stage, i) => {
          const isOpen = openIdx === i;
          return (
            <div key={stage.stage_number}>
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : i)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-brand-off-white dark:hover:bg-[#282828] transition-colors"
              >
                {/* Stage number badge */}
                <span className={cn(
                  'size-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold',
                  isOpen
                    ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                    : 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-mid-grey',
                )}>
                  {stage.stage_number}
                </span>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white">{stage.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-brand-mid-grey">{STAGE_DAYS[i]}d est.</span>
                    <span className="text-[10px] text-brand-mid-grey">{stage.budget_pct}% of budget</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="hidden sm:block w-20 h-1 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden shrink-0">
                  <div className="h-full bg-brand-near-black dark:bg-white rounded-full" style={{ width: `${stage.budget_pct * 4}%` }} />
                </div>

                {isOpen
                  ? <ChevronUp className="size-4 text-brand-mid-grey shrink-0" />
                  : <ChevronDown className="size-4 text-brand-mid-grey shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-5 pb-5 bg-brand-off-white dark:bg-[#1a1a1a]">
                  <div className="grid sm:grid-cols-2 gap-5 pt-4">
                    {/* Substages */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-2">Substages</p>
                      <ul className="flex flex-col gap-1.5">
                        {stage.substages.map(sub => (
                          <li key={sub} className="flex items-start gap-2 text-xs text-brand-near-black dark:text-white">
                            <span className="size-1.5 rounded-full bg-brand-mid-grey mt-1.5 shrink-0" />
                            {sub}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-1">Typical Duration</p>
                        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{STAGE_DAYS[i]} days</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-1">Budget Allocation</p>
                        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{stage.budget_pct}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-1">Payment Timing</p>
                        <p className="text-xs text-brand-near-black dark:text-white">{PAYMENT_NOTE[i]}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="mt-10 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <p className="text-xs text-brand-mid-grey">
          <span className="font-semibold text-brand-near-black dark:text-white">Building soon?</span> Create a Groundwork account to track each substage with evidence, approvals, and contractor coordination.
        </p>
        <Link to="/auth/signup" className="shrink-0 inline-flex rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
          Get started free
        </Link>
      </div>
    </div>
  );
}
