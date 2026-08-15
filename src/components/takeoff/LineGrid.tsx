import { useState } from 'react';
import { RotateCcw, Pencil, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { formatLocalCurrency } from '@/lib/budget';
import type { TakeoffLine, OverrideMap } from '@/lib/budget';

// =========================================================
// The editable take-off grid.
//
// OVERRIDE, DON'T ENTER. Every line arrives priced by the engine; a contractor edits only
// what differs from their own supplier. A blank 500-row form is the failure mode this
// whole feature exists to avoid — relocating it from Excel into React would be no gain.
//
// Two affordances carry that idea: an overridden line is badged and can be reset to the
// model value in one click, so it is always obvious which numbers are ours and which are
// theirs. That distinction is what the owner is really reading when they compare.
// =========================================================

function NumberCell({
  value, modelValue, onChange, disabled, align = 'right',
}: {
  value: number;
  modelValue: number;
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
}) {
  // Local string state so a half-typed "4." or an empty box does not immediately reprice
  // the whole document to NaN and back.
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? String(Math.round(value * 100) / 100);
  const dirty = Math.abs(value - modelValue) > 1e-9;

  return (
    <input
      inputMode="decimal"
      disabled={disabled}
      value={shown}
      onChange={e => {
        const next = e.target.value.replace(/[^0-9.]/g, '');
        setRaw(next);
        const n = Number(next);
        onChange(next === '' || !Number.isFinite(n) ? undefined : n);
      }}
      onBlur={() => setRaw(null)}
      className={cn(
        'w-full rounded-lg border bg-transparent px-2 py-1 text-xs tabular-nums',
        'focus:outline-none focus:border-brand-near-black dark:focus:border-white',
        align === 'right' ? 'text-right' : 'text-left',
        dirty
          ? 'border-brand-near-black font-semibold text-brand-near-black dark:border-white dark:text-white'
          : 'border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]',
        disabled && 'opacity-60',
      )}
    />
  );
}

export function LineGrid({
  lines, modelLines, overrides, currencyCode, readOnly, onChange,
}: {
  /** Priced lines, overrides already applied. */
  lines: TakeoffLine[];
  /** The same lines with no overrides — what "reset" restores. */
  modelLines: TakeoffLine[];
  overrides: OverrideMap;
  currencyCode: string;
  readOnly?: boolean;
  onChange: (next: OverrideMap) => void;
}) {
  const t = useT();
  const model = new Map(modelLines.map(l => [l.code, l]));

  function patch(code: string, field: 'qty' | 'rate', v: number | undefined) {
    const next = { ...overrides, [code]: { ...overrides[code], [field]: v } };
    // An override that is entirely empty is removed rather than stored as {}, so
    // `overridden` stays an honest signal.
    if (next[code].qty === undefined && next[code].rate === undefined && !next[code].note) {
      delete next[code];
    }
    onChange(next);
  }

  function reset(code: string) {
    const next = { ...overrides };
    delete next[code];
    onChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border-grey dark:border-[#2c2c2c]">
      <table className="w-full min-w-[42rem] text-left">
        <thead>
          <tr className="border-b border-brand-border-grey bg-brand-off-white text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
            <th className="px-3 py-2 w-14">{t('takeoff.colCode')}</th>
            <th className="px-3 py-2">{t('takeoff.colItem')}</th>
            <th className="px-3 py-2 w-14">{t('takeoff.colUnit')}</th>
            <th className="px-3 py-2 w-24 text-right">{t('takeoff.colQty')}</th>
            <th className="px-3 py-2 w-28 text-right">{t('takeoff.colRate')}</th>
            <th className="px-3 py-2 w-32 text-right">{t('takeoff.colAmount')}</th>
            <th className="px-3 py-2 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-off-white dark:divide-[#242424]">
          {lines.map((l, i) => {
            const m = model.get(l.code);
            const isPct = l.kind === 'percentage';
            return (
              // Keyed on index, not code: three upper floors emit 305 three times and a
              // code-keyed list would collapse them into one row.
              <tr key={`${l.code}-${i}`} className={cn(l.overridden && 'bg-brand-off-white/60 dark:bg-[#1e1e1e]')}>
                <td className="px-3 py-2 text-[11px] tabular-nums text-brand-mid-grey">{l.code}</td>
                <td className="px-3 py-2">
                  <span className="text-xs text-brand-near-black dark:text-white">{t(l.labelKey)}</span>
                  {l.rateSource === 'estimated' && (
                    <span
                      title={t('takeoff.provisionalHint')}
                      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-dashed border-brand-border-grey px-1.5 text-[9px] text-brand-mid-grey"
                    >
                      <AlertTriangle className="size-2.5" /> {t('takeoff.estimated')}
                    </span>
                  )}
                  {l.overridden && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-brand-near-black px-1.5 text-[9px] text-white dark:bg-white dark:text-brand-near-black">
                      <Pencil className="size-2.5" /> {t('takeoff.yours')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-brand-mid-grey">{l.unit}</td>
                <td className="px-3 py-2">
                  {isPct ? (
                    <span className="block text-right text-xs tabular-nums text-brand-mid-grey">—</span>
                  ) : (
                    <NumberCell
                      value={l.qty} modelValue={m?.qty ?? l.qty} disabled={readOnly}
                      onChange={v => patch(l.code, 'qty', v)}
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  {isPct ? (
                    <span className="block text-right text-xs tabular-nums text-brand-mid-grey">
                      {(l.pct ?? 0).toFixed(1)}%
                    </span>
                  ) : (
                    <NumberCell
                      value={l.rate} modelValue={m?.rate ?? l.rate} disabled={readOnly}
                      onChange={v => patch(l.code, 'rate', v)}
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-brand-near-black dark:text-white">
                  {formatLocalCurrency(Math.round(l.amount), currencyCode)}
                </td>
                <td className="px-3 py-2">
                  {l.overridden && !readOnly && (
                    <button
                      type="button"
                      onClick={() => reset(l.code)}
                      title={t('takeoff.resetLine')}
                      aria-label={t('takeoff.resetLine')}
                      className="text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
