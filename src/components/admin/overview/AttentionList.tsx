import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { ageHours, type ActionItem, type Priority } from '@/lib/admin/action-center';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Needs your attention — the Action Center's items, rendered.
//
// The list is whatever `actionCenterItems()` computed from live rows this load: nothing
// is stored, nothing is hand-maintained, and an empty list means there is genuinely
// nothing waiting. Every row carries what · which project or person · how old · how
// urgent, and opens where the admin acts (03 §5).
// =========================================================

const DOT: Record<Priority, string> = {
  critical: 'bg-state-alert',
  high:     'bg-state-held',
  medium:   'bg-brand-muted-grey',
  low:      'bg-brand-border-grey',
};

export function AttentionList({ items, now, limit }: { items: ActionItem[]; now: Date; limit?: number }) {
  const t = useT();
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {shown.map(item => {
        const hours = ageHours(item.since, now);
        const age = hours >= 48
          ? t('admin.attention.ageDays', { days: Math.round(hours / 24) })
          : t('admin.attention.age', { hours: Math.max(1, Math.round(hours)) });
        // Person · project · channel. A conversation with no project says nothing about
        // one rather than borrowing the person's other builds — that inference belongs to
        // the Inbox, where an admin can see which project it might be.
        const context = [item.personName, item.projectName, item.channel && t(`admin.workspace.conversations.channel.${item.channel}` as TKey)]
          .filter(Boolean).join(' · ');
        return (
          <li key={item.key}>
            <Link
              to={item.to}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]"
            >
              <span className={cn('size-2 shrink-0 rounded-full', DOT[item.priority])}
                title={t(`admin.attention.priority.${item.priority}` as TKey)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">
                  {t(`admin.attention.kind.${item.kind}` as TKey)}
                  {item.stageNumber != null && (
                    <span className="font-normal text-brand-mid-grey"> · {t('admin.ops.pipelineStage', { n: item.stageNumber })}</span>
                  )}
                </span>
                {/* What they actually said, when we have it: triage without opening it. */}
                {item.preview && <span className="mt-0.5 block truncate text-xs text-brand-near-black dark:text-white">{item.preview}</span>}
                {context && <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">{context}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-brand-mid-grey">{age}</span>
              <ChevronRight className="size-4 shrink-0 text-brand-muted-grey" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
