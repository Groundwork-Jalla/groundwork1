import { motion } from 'framer-motion';
import { Link, NavLink, useLocation } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT, type TKey } from '@/lib/i18n';
import { useJoinDestination } from "@/hooks/useJoinDestination";
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

// `/community` stays: it is the way into the Skool community sign-up, which is a
// different destination from creating a Groundwork account. Only the primary CTA
// moved to /auth/signup — see the buttons below.
const LINKS: { to: string; labelKey: TKey }[] = [
  { to: '/pricing',   labelKey: 'nav.pricing' },
  { to: '/tools',     labelKey: 'nav.freeTools' },
  { to: '/community', labelKey: 'nav.community' },
];

export function SiteNav() {
  const t = useT();
  const join = useJoinDestination();
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
      <div className="mx-auto flex max-w-275 items-center justify-between px-3 py-3.5 sm:px-7">
        <div className="flex min-w-0 items-center gap-7">
          {/* The wordmark is the largest fixed element in the bar. One size down
              below sm buys the ~20px that keeps both CTAs on screen at 320px. */}
          <span className="sm:hidden"><GroundworkLogo variant="light" size="lg" linkTo="/" /></span>
          <span className="hidden sm:block"><GroundworkLogo variant="light" size="xl" linkTo="/" /></span>
          <div className="hidden items-center gap-6 lg:flex">
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
            className="h-9 shrink-0 rounded-md border-white/20 bg-transparent px-2.5 text-[11px] font-medium text-white/75 hover:bg-white/10 hover:text-white sm:h-auto sm:px-4 sm:py-2 sm:text-xs"
          >
            {onContractorPage ? (
              <a href="#apply">
                <span className="hidden sm:inline">{t('contractorApply.nav.apply')}</span>
                <span className="sm:hidden">{t('contractorApply.nav.applyShort')}</span>
              </a>
            ) : (
              <Link to="/contractor-apply">
                {/* Full label from sm up; short one below it so both CTAs fit at 375px. */}
                <span className="hidden sm:inline">{t('landing.nav.forContractors')}</span>
                <span className="sm:hidden">{t('landing.nav.forContractorsShort')}</span>
              </Link>
            )}
          </Button>
          {/* The one action the bar is for. Heavier weight, more padding and a lift
              off the dark ground, so it outranks the contractor button rather than
              merely differing from it — white-on-black alone read as a peer.

              Literal hex rather than bg-white/text-brand-near-black: globals.css
              carries a blanket `html.dark .bg-white { background: #1e1e1e }` for card
              surfaces and it outranks the utility. This bar is dark in BOTH themes, so
              that rule painted the primary CTA #1e1e1e on #0a0a0a — all but invisible
              the moment anyone switched to dark mode. */}
          <Button
            asChild
            className="group h-9 shrink-0 rounded-md bg-[#ffffff] px-3 text-[11px] font-bold text-[#0a0a0a] shadow-[0_1px_12px_rgba(255,255,255,0.18)] hover:bg-[#f0f0f0] sm:h-auto sm:px-7 sm:py-2.5 sm:text-[13px]"
          >
            {/* Destination follows the hero button — a browser that has signed in here
                before gets the log-in page. The bar carries no separate log-in link, so
                without this a returning visitor has no way back in from the top of the
                page. See lib/auth/returning-user.ts. */}
            <Link to={join} className="flex items-center gap-1.5">
              {/* Full label from sm up; short one below it so both CTAs fit at 375px. */}
              <span className="hidden sm:inline">{t('landing.nav.joinFree')}</span>
              <span className="sm:hidden">{t('landing.nav.joinFreeShort')}</span>
              {/* Decorative; it is the last ~18px that pushes the bar past a 320px
                  viewport, and the button reads fine without it. */}
              <ArrowRight className="hidden size-3.5 transition-transform duration-300 group-hover:translate-x-1 sm:inline" />
            </Link>
          </Button>
        </div>
      </div>
    </motion.nav>
  );
}

export default SiteNav;
