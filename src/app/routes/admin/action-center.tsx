import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { loadActionCenter, type ActionCenterData } from '@/lib/supabase/action-center';
import { AttentionList } from '@/components/admin/overview/AttentionList';
import { EmptyState } from '@/components/ui/EmptyState';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Priority } from '@/lib/admin/action-center';

// =========================================================
// /admin/action-center — the whole queue behind the Overview's five-row preview.
//
// The Overview shows five items and says "See all"; this is what it opens. Same
// projection, same rules, no limit — a preview and its module must never be two datasets.
//
// NOTHING IS STORED. Every item is computed from live rows on load by
// `actionCenterItems()` (03 §5, thirteen rules). There is no "dismiss": an item leaves
// this list when the thing that caused it is dealt with, which is the only honest way for
// a queue derived from state to empty.
//
// 18 Nov redesign (action-center-desktop.png): pill tabs with each priority's dot, and the
// queue headed by priority — "Critical · 1", "High · 5" — so the shape of the desk reads
// before the rows do. Same items, same order, same links.
// =========================================================

const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

export default function AdminActionCenter() {
  const t = useT();
  const [now] = useState(() => new Date());
  const [data, setData]   = useState<ActionCenterData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `?priority=` keeps a narrowed queue shareable and survives a reload.
  const [params, setParams] = useSearchParams();
  const raw = params.get('priority');
  const priority = PRIORITIES.includes(raw as Priority) ? (raw as Priority) : null;
  const setPriority = (next: Priority | null) => {
    const p = new URLSearchParams(params);
    if (next) p.set('priority', next); else p.delete('priority');
    setParams(p, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    loadActionCenter(now)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(errorMessage(e, t('common.somethingWrong'))); });
    return () => { alive = false; };
  }, [now, t]);

  const counts = useMemo(() => {
    const out: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of data?.items ?? []) out[i.priority] += 1;
    return out;
  }, [data]);

  const items = priority ? (data?.items ?? []).filter(i => i.priority === priority) : (data?.items ?? []);
  const unavailable = data
    ? Object.entries(data.available).filter(([, ok]) => !ok).map(([k]) => k)
    : [];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('admin.attention.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.actionCenter.subtitle')}</p>
      </header>

      {error && <p role="alert" className="mb-4 text-sm text-state-alert">{error}</p>}

      {!data ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : (
        <>
          {/* Priority tabs. Counts are the real ones; a band with none still shows its 0,
              because "nothing critical" is information. */}
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            <Tab active={!priority} onClick={() => setPriority(null)}
              label={t('admin.actionCenter.all')} count={data.items.length} />
            {PRIORITIES.map(p => (
              <Tab key={p} active={priority === p} onClick={() => setPriority(p)}
                label={t(`admin.attention.priority.${p}` as TKey)} count={counts[p]} dot={TAB_DOT[p]} />
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyState title={t('admin.attention.empty')} description={t('admin.actionCenter.emptyBody')} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <AttentionList items={items} now={now} grouped />
            </div>
          )}

          {unavailable.length > 0 && (
            <p className="mt-4 text-[11px] text-brand-mid-grey">
              {t('admin.attention.partial', { what: unavailable.join(', ') })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const TAB_DOT: Record<Priority, string> = {
  critical: 'bg-state-alert',
  high:     'bg-state-held',
  medium:   'bg-brand-muted-grey',
  low:      'bg-brand-border-grey',
};

function Tab({ active, label, count, dot, onClick }: { active: boolean; label: string; count: number; dot?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
        active
          ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]'
          : 'border-brand-border-grey bg-white text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:text-white',
      )}
    >
      {dot && <span aria-hidden className={cn('size-2 rounded-full', dot)} />}
      {label} <span className="tabular-nums opacity-75">{count}</span>
    </button>
  );
}
