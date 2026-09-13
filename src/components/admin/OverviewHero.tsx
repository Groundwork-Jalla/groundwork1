import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The Overview's header band.
//
// ASSET-SWAPPABLE BY DESIGN. The visual reference (the dark concept in docs/admin, 13 Sep
// 2026) puts a construction photograph behind this band. Jalla will supply a licensed
// photograph of a real site; none is sourced or generated here. Until it arrives the band
// renders the brand's own tonal treatment, and the swap is one line:
//
//     <OverviewHero image="/brand/site-hero.jpg" … />
//
// Nothing else changes — the overlay, the type scale and both themes already assume an
// image may be there. In dark mode the band is near-black with a light scrim; in light
// mode the same composition on an off-white ground, so the two are one design, not two.
// =========================================================

export interface OverviewHeroProps {
  /** Empty when the account has no real name — the greeting then carries no name at all. */
  name: string;
  /** Supplied once Jalla provides the photograph. Absent → the tonal brand treatment. */
  image?: string;
  now: Date;
}

export function OverviewHero({ name, image, now }: OverviewHeroProps) {
  const t = useT();
  const hour = now.getHours();
  // No name, no name: an admin whose profile carries no full name is greeted plainly
  // rather than by something derived from their email address.
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const greeting = (name ? `admin.hero.${part}` : `admin.hero.${part}Plain`) as
    'admin.hero.morning' | 'admin.hero.afternoon' | 'admin.hero.evening'
    | 'admin.hero.morningPlain' | 'admin.hero.afternoonPlain' | 'admin.hero.eveningPlain';
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border',
        'border-brand-border-grey bg-brand-light-grey',
        'dark:border-[#2c2c2c] dark:bg-[#161616]',
      )}
    >
      {image && (
        <>
          <img src={image} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
          {/* The scrim is what keeps the type readable whatever the photograph is, and
              what makes the same asset work in both themes. */}
          <div className="absolute inset-0 bg-white/70 dark:bg-black/60" />
        </>
      )}

      <div className="relative flex flex-col gap-4 px-6 py-7 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-9">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-mid-grey">
            {t('admin.overviewTitle')}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-brand-near-black dark:text-white sm:text-3xl">
            {t(greeting, { name })}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-brand-mid-grey">{t('admin.hero.sub')}</p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-mid-grey">{t('admin.hero.today')}</p>
          <p className="mt-1 text-sm font-medium text-brand-near-black dark:text-white">{dateLabel}</p>
        </div>
      </div>
    </section>
  );
}
