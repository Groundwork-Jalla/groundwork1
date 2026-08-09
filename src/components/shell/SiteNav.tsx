import { motion } from 'framer-motion';
import { Link, NavLink, useLocation } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The public navbar — every signed-out page.
//
// Promoted from LandingNav, which was the only real one: `pricing` and `verify`
// had hand-rolled copies and `contractor-apply` and `community` had none at all,
// so a visitor could land on the contractor form with no way back to the site.
//
// The destination links are new here. The landing page never needed them (it
// scrolls), but on an inner page a bar with no navigation is a dead end.
// =========================================================

const LINKS: { to: string; labelKey: TKey }[] = [
  { to: '/pricing',   labelKey: 'nav.pricing' },
  { to: '/tools',     labelKey: 'nav.freeTools' },
  { to: '/community', labelKey: 'nav.community' },
];

export function SiteNav() {
  const t = useT();
  const { pathname } = useLocation();

  // On the contractor page itself, "Join as a Contractor" would link to the page
  // you are already on. Point it at the form instead — that page is long, and the
  // sticky jump to #apply was the conversion path its own navbar used to provide.
  const onContractorPage = pathname === '/contractor-apply';

  return (
    <motion.nav
      aria-label={t('nav.mainNavigation')}
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="sticky top-0 z-50 border-b border-white/10 bg-brand-near-black backdrop-blur-lg"
    >
      <div className="mx-auto flex max-w-275 items-center justify-between px-4 py-3.5 sm:px-7">
        <div className="flex items-center gap-7">
          <GroundworkLogo variant="light" size="xl" linkTo="/" />
          <div className="hidden items-center gap-6 md:flex">
            {LINKS.map(({ to, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'text-xs font-medium transition-colors',
                    isActive ? 'text-white' : 'text-white/55 hover:text-white',
                  )
                }
              >
                {t(labelKey)}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Below sm the bar is width-critical: logo + language + two CTAs measured
            425px against a 375px viewport, which clipped the primary CTA mid-word
            and overlapped the wordmark. Every element here shrinks rather than one
            of them being dropped — the contractor entry point in particular is
            meant to be reachable at every width. */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <span className="hidden sm:block"><LanguageToggle segmented onDark /></span>
          <span className="sm:hidden"><LanguageToggle compact onDark /></span>
          {/* Contractor entry point. Bordered at every width — as a ghost button it
              read as a footnote and the contractor page was effectively only
              reachable from the footer. `variant="outline"` assumes a light
              background, so the dark-bar colours are set here. */}
          <Button
            asChild
            variant="outline"
            className="h-9 shrink-0 rounded-md border-white/25 bg-transparent px-2.5 text-[11px] font-semibold text-white hover:bg-white/10 hover:text-white sm:h-auto sm:px-4 sm:py-2 sm:text-xs"
          >
            {onContractorPage ? (
              <a href="#apply">
                {t('contractorApply.nav.apply')}
              </a>
            ) : (
              <Link to="/contractor-apply">
                {/* Full label from sm up; short one below it so both CTAs fit at 375px. */}
                <span className="hidden sm:inline">{t('landing.nav.forContractors')}</span>
                <span className="sm:hidden">{t('landing.nav.forContractorsShort')}</span>
              </Link>
            )}
          </Button>
          <Button
            asChild
            className="group h-9 shrink-0 rounded-md bg-white px-3 text-[11px] font-semibold text-brand-near-black hover:bg-brand-off-white sm:h-auto sm:px-6 sm:py-2 sm:text-xs"
          >
            <Link to="/community" className="flex items-center gap-1.5">
              <span className="hidden sm:inline">{t('landing.nav.joinFree')}</span>
              <span className="sm:hidden">{t('landing.nav.joinFreeShort')}</span>
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      </div>
    </motion.nav>
  );
}

export default SiteNav;
