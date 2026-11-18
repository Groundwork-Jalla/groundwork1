import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { Priority } from '@/lib/admin/action-center';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The Overview's header band (redesign, 18 Nov 2026 — overview-desktop.png).
//
// "What needs me" comes first: the greeting carries the Action Center's own counts by
// priority and the one button that opens it. The counts are whatever
// `actionCenterItems()` computed this load — `null` while it loads or when it failed,
// and then no chips at all rather than a row of zeros that would mean "we could not look".
//
// ASSET-SWAPPABLE BY DESIGN. Jalla will supply a licensed photograph of a real site; none
// is sourced or generated here. Until it arrives the band is the brand green, and the swap
// is one line: `<OverviewHero image="/brand/site-hero.jpg" … />`. The scrim keeps the white
// type readable whatever the photograph is.
// =========================================================

export interface OverviewHeroProps {
  /** Empty when the account has no real name — the greeting then carries no name at all. */
  name: string;
  /** Supplied once Jalla provides the photograph. Absent → the brand green. */
  image?: string;
  now: Date;
  /** The Action Center's items counted by priority; null while unknown. */
  counts?: Partial<Record<Priority, number>> | null;
  /** Where the button goes — the Action Center. */
  actionTo?: string;
}

const CHIP_DOT: Record<Priority, string> = {
  critical: 'bg-[#ff8a8a]',
  high:     'bg-[#f0c27a]',
  medium:   'bg-[#b9b0e6]',
  low:      'bg-white/50',
};
const ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

export function OverviewHero({ name, image, now, counts, actionTo }: OverviewHeroProps) {
  const t = useT();
  const hour = now.getHours();
  // No name, no name: an admin whose profile carries no full name is greeted plainly
  // rather than by something derived from their email address.
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const greeting = (name ? `admin.hero.${part}` : `admin.hero.${part}Plain`) as
    'admin.hero.morning' | 'admin.hero.afternoon' | 'admin.hero.evening'
    | 'admin.hero.morningPlain' | 'admin.hero.afternoonPlain' | 'admin.hero.eveningPlain';
  const chips = counts ? ORDER.filter(p => (counts[p] ?? 0) > 0) : [];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand-green text-white">
      {image && (
        <>
          <img src={image} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-black/55" />
        </>
      )}
      {/* The quiet disc in the corner is the band's only ornament. */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/[0.06]" />

      <div className="relative flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
            {t('admin.overviewTitle')}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-[28px]">
            {t(greeting, { name })}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/80">{t('admin.hero.sub')}</p>

          {counts && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {chips.length === 0 ? (
                <span className="rounded-full bg-white/[0.12] px-3 py-1 text-xs font-semibold">{t('admin.hero.nothingWaiting')}</span>
              ) : chips.map(p => (
                <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.12] px-3 py-1 text-xs font-semibold">
                  <span aria-hidden className={cn('size-[7px] rounded-full', CHIP_DOT[p])} />
                  {t('admin.hero.priorityCount', { n: counts[p] ?? 0, level: t(`admin.attention.priority.${p}` as TKey).toLowerCase() })}
                </span>
              ))}
            </div>
          )}
        </div>

        {actionTo && (
          <Link
            to={actionTo}
            className="inline-flex shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-brand-green transition-colors hover:bg-white/90 sm:self-auto"
          >
            {t('admin.hero.openActionCenter')}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    </section>
  );
}
