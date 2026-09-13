import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';

// =========================================================
// "You are looking at a subset."
//
// Every destination reached from an Overview KPI shows this, and it is not decoration:
// an admin who clicks "Projects at risk — 3" and lands on a three-row table must be able
// to tell that from a three-row table that is the whole fleet. It names the filter, the
// count it produced, the count it came out of, and how to get back to everything.
// =========================================================

export function FilterBanner({ label, shown, total, onClear }: {
  /** Already translated — the filter in the admin's own words ("At risk", "Pending"). */
  label: string;
  shown: number;
  total: number;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#e4e3df] bg-[#f7f7f5] px-4 py-2.5 dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
      <span className="text-xs font-semibold text-[#0a0a0a] dark:text-white">{t('admin.filter.showing', { label })}</span>
      <span className="text-xs tabular-nums text-[#5a5a57] dark:text-white/60">{t('admin.filter.count', { shown, total })}</span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#5a5a57] transition-colors hover:bg-white hover:text-[#0a0a0a] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <X className="size-3" />
        {t('admin.filter.clear')}
      </button>
    </div>
  );
}
