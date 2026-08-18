import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronUp, ChevronDown } from 'lucide-react';
import { BUDGET_SLICES, calculateBudget, sliceShares } from '@/lib/budget';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import type { WizardFormData } from '@/types/project';
import { useT, useFormat, type TKey } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

const FINISH_LEVELS = [
  { value: 'standard', labelKey: 'tools.finish.standard', descKey: 'tools.finish.standardDesc' },
  { value: 'premium',  labelKey: 'tools.finish.premium',  descKey: 'tools.finish.premiumDesc'  },
  { value: 'luxury',   labelKey: 'tools.finish.luxury',   descKey: 'tools.finish.luxuryDesc'   },
] as const satisfies readonly { value: string; labelKey: TKey; descKey: TKey }[];

/**
 * What the tool assumes so it can ask four questions instead of nine.
 *
 * `long_span_aluminum` and `single_family` are the common case in the Cameroon
 * corridor; one living room and one kitchen match a typical family home. Surfaced
 * to the visitor as `tools.assumes` rather than left implicit — a figure someone
 * plans a build around should say what it priced.
 */
const ASSUMED = {
  buildingType:    'single_family',
  roofType:        'long_span_aluminum',
  livingRooms:     1,
  kitchens:        1,
  offices:         0,
  hasBoysQuarters: false,
} as const satisfies Partial<WizardFormData>;

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
  const t = useT();
  // useFormat rather than the bare money helpers in '@/lib/budget': those read a
  // module-level locale that LanguageProvider only sets in an effect, so a first
  // paint in French shows English figures and never corrects itself.
  const f = useFormat();
  const labels = useDomainLabels();
  const [country, setCountry] = useState(DEFAULT_COUNTRY_CODE);
  const [sqm, setSqm] = useState(150);
  const [floors, setFloors] = useState(1);
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [finishLevel, setFinishLevel] = useState<'standard' | 'premium' | 'luxury'>('standard');

  // Room counts are not decoration here: for a country with a take-off model
  // (Cameroon today) the engine prices doors, windows, sanitary ware and finishes
  // off them. Passing only country/sqm/floors quoted an empty shell — 150 sqm came
  // out at $39,072 against the wizard's $52,311 for the same build, a 34% shortfall
  // in the direction that hurts, since someone budgets against this figure.
  //
  // The rest are fixed rather than asked for. They move the total far less than
  // beds and baths do, and this page has to stay a 30-second answer; ASSUMPTIONS
  // below is shown on the page so the number is not silently a different build
  // from the one the visitor has in mind.
  const budget = useMemo(() =>
    calculateBudget({ country, sqm, floors, finishLevel, bedrooms, bathrooms, ...ASSUMED }),
    [country, sqm, floors, finishLevel, bedrooms, bathrooms],
  );
  const shares = useMemo(() => sliceShares(budget), [budget]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <Link to="/tools" className="inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white mb-8 transition-colors">
        <ChevronLeft className="size-3.5" /> {t('tools.backToTools')}
      </Link>

      <h1 className="text-2xl sm:text-3xl font-black text-brand-near-black dark:text-white mb-2">{t('tools.budgetTitle')}</h1>
      <p className="text-sm text-brand-mid-grey mb-10">{t('tools.budgetSub')}</p>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* ── Form ── */}
        <div className="flex flex-col gap-6">
          {/* Country */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">{t('tools.country')}</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-sm text-brand-near-black dark:text-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white"
            >
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.flag} {labels.country(c.code)}</option>
              ))}
            </select>
          </div>

          {/* sqm + floors */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5 flex flex-col gap-5">
            <div>
              <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">
                {t('tools.floorArea')}
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

            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">{t('tools.floors')}</label>
                <Stepper value={floors} onChange={setFloors} min={1} max={10} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">{t('wizardFields.bedrooms')}</label>
                <Stepper value={bedrooms} onChange={setBedrooms} min={0} max={20} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">{t('wizardFields.bathrooms')}</label>
                <Stepper value={bathrooms} onChange={setBathrooms} min={0} max={20} />
              </div>
            </div>
          </div>

          {/* Finish level */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-3 uppercase tracking-wide">{t('tools.finishLevel')}</label>
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
                    <p className={`text-sm font-semibold ${finishLevel === fl.value ? 'text-white dark:text-brand-near-black' : 'text-brand-near-black dark:text-white'}`}>{t(fl.labelKey)}</p>
                    <p className={`text-xs ${finishLevel === fl.value ? 'text-white/70 dark:text-brand-near-black/70' : 'text-brand-mid-grey'}`}>{t(fl.descKey)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Result ── */}
        <div className="lg:sticky lg:top-24 flex flex-col gap-4">
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <p className="text-xs text-brand-mid-grey mb-1">{t('tools.estimatedCost')}</p>
            <p className="text-4xl font-black text-brand-near-black dark:text-white tabular-nums mb-1">{f.money(budget.total)}</p>
            <p className="text-xs text-brand-mid-grey mb-5">
              {t('tools.estimateMeta', {
                sqm,
                floors,
                floorWord: t(floors === 1 ? 'tools.floorSingular' : 'tools.floorPlural'),
                // The raw enum value read as English on the French page.
                finish: t(`tools.finish.${finishLevel}` as TKey).toLowerCase(),
              })}
            </p>

            <div className="flex flex-col gap-2.5">
              {BUDGET_SLICES.map(s => (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-brand-mid-grey">{t(s.labelKey)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
                    <div className="h-full bg-brand-near-black dark:bg-white rounded-full" style={{ width: `${shares[s.key]}%` }} />
                  </div>
                  <span className="text-xs font-medium text-brand-near-black dark:text-white tabular-nums w-20 text-right">{f.money(budget[s.key])}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[10px] text-brand-mid-grey leading-relaxed">
              {t('tools.indicative')}
            </p>
            <p className="mt-1.5 text-[10px] text-brand-mid-grey leading-relaxed">
              {t('tools.assumes')}
            </p>
          </div>

          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-4">
            <p className="text-xs font-semibold text-brand-near-black dark:text-white mb-1">{t('tools.trackReal')}</p>
            <p className="text-[11px] text-brand-mid-grey mb-3">{t('tools.trackRealBody')}</p>
            <Link to="/auth/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
              {t('tools.getStartedFree')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
