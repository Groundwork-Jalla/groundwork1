import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronUp, ChevronDown } from 'lucide-react';
import { calculateBudget, formatUSDFull, formatUSD } from '@/lib/budget';
import { COUNTRIES } from '@/lib/countries';

const FINISH_LEVELS = [
  { value: 'standard', label: 'Standard', desc: 'Functional, cost-effective finishes' },
  { value: 'premium',  label: 'Premium',  desc: 'Mid-range quality fittings and finishes' },
  { value: 'luxury',   label: 'Luxury',   desc: 'High-end materials and custom finishes' },
] as const;

const BUDGET_SLICES = [
  { label: 'Materials',       key: 'materials'   as const, pct: 41 },
  { label: 'Labor',           key: 'labor'        as const, pct: 23 },
  { label: 'Engineering',     key: 'engineering'  as const, pct: 16 },
  { label: 'Proj. Management',key: 'management'   as const, pct: 10 },
  { label: 'Contingency',     key: 'contingency'  as const, pct: 8  },
  { label: 'Permits',         key: 'permits'      as const, pct: 2  },
];

function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg overflow-hidden w-28">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="px-3 py-2 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white disabled:opacity-30 transition-colors">
        <ChevronDown className="size-4" />
      </button>
      <span className="flex-1 text-center text-sm font-semibold text-brand-near-black dark:text-white tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="px-3 py-2 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white disabled:opacity-30 transition-colors">
        <ChevronUp className="size-4" />
      </button>
    </div>
  );
}

export default function BudgetTool() {
  const [country, setCountry] = useState('NG');
  const [sqm, setSqm] = useState(150);
  const [floors, setFloors] = useState(1);
  const [finishLevel, setFinishLevel] = useState<'standard' | 'premium' | 'luxury'>('standard');

  const budget = useMemo(() =>
    calculateBudget({ country, sqm, floors, finishLevel }),
    [country, sqm, floors, finishLevel],
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <Link to="/tools" className="inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white mb-8 transition-colors">
        <ChevronLeft className="size-3.5" /> Back to Tools
      </Link>

      <h1 className="text-2xl sm:text-3xl font-black text-brand-near-black dark:text-white mb-2">Build Budget Calculator</h1>
      <p className="text-sm text-brand-mid-grey mb-10">Enter your project details. Costs update live as you adjust the inputs.</p>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* ── Form ── */}
        <div className="flex flex-col gap-6">
          {/* Country */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">Country</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-sm text-brand-near-black dark:text-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white"
            >
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
              ))}
            </select>
          </div>

          {/* sqm + floors */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5 flex flex-col gap-5">
            <div>
              <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">
                Floor Area (sqm)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={30}
                  max={1000}
                  step={10}
                  value={sqm}
                  onChange={e => setSqm(Number(e.target.value))}
                  className="flex-1 accent-brand-near-black dark:accent-white"
                />
                <input
                  type="number"
                  min={30}
                  max={1000}
                  value={sqm}
                  onChange={e => setSqm(Math.max(30, Math.min(1000, Number(e.target.value))))}
                  className="w-20 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-sm text-brand-near-black dark:text-white px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">Floors</label>
              <Stepper value={floors} onChange={setFloors} min={1} max={10} />
            </div>
          </div>

          {/* Finish level */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-3 uppercase tracking-wide">Finish Level</label>
            <div className="flex flex-col gap-2">
              {FINISH_LEVELS.map(fl => (
                <button
                  key={fl.value}
                  type="button"
                  onClick={() => setFinishLevel(fl.value)}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                    finishLevel === fl.value
                      ? 'border-brand-near-black dark:border-white bg-brand-near-black dark:bg-white'
                      : 'border-brand-border-grey dark:border-[#2c2c2c] hover:border-brand-near-black dark:hover:border-[#555]'
                  }`}
                >
                  <div className={`mt-0.5 size-3.5 rounded-full border-2 shrink-0 ${
                    finishLevel === fl.value
                      ? 'border-white dark:border-brand-near-black bg-white dark:bg-brand-near-black'
                      : 'border-brand-border-grey dark:border-[#555]'
                  }`} />
                  <div>
                    <p className={`text-sm font-semibold ${finishLevel === fl.value ? 'text-white dark:text-brand-near-black' : 'text-brand-near-black dark:text-white'}`}>{fl.label}</p>
                    <p className={`text-xs ${finishLevel === fl.value ? 'text-white/70 dark:text-brand-near-black/70' : 'text-brand-mid-grey'}`}>{fl.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Result ── */}
        <div className="lg:sticky lg:top-24 flex flex-col gap-4">
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <p className="text-xs text-brand-mid-grey mb-1">Estimated build cost</p>
            <p className="text-4xl font-black text-brand-near-black dark:text-white tabular-nums mb-1">{formatUSDFull(budget.total)}</p>
            <p className="text-xs text-brand-mid-grey mb-5">USD · indicative · {sqm} sqm · {floors} floor{floors !== 1 ? 's' : ''} · {finishLevel}</p>

            <div className="flex flex-col gap-2.5">
              {BUDGET_SLICES.map(s => (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-brand-mid-grey">{s.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
                    <div className="h-full bg-brand-near-black dark:bg-white rounded-full" style={{ width: `${s.pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-brand-near-black dark:text-white tabular-nums w-20 text-right">{formatUSD(budget[s.key])}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[10px] text-brand-mid-grey leading-relaxed">
              Indicative only. Actual costs vary by site, contractor, and local market.
            </p>
          </div>

          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-4">
            <p className="text-xs font-semibold text-brand-near-black dark:text-white mb-1">Want to track a real project?</p>
            <p className="text-[11px] text-brand-mid-grey mb-3">Create a Groundwork account to manage stages, documents, and contractor payments.</p>
            <Link to="/auth/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
              Get started free
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
