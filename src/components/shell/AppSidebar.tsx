import { Fragment } from 'react';
import { NavLink, Link } from 'react-router';
import { LogOut, User } from 'lucide-react';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { NavItem } from './nav-config';

// =========================================================
// The one sidebar.
//
// The client and admin shells previously had separate implementations that had
// drifted apart: different corner radii and row padding, hardcoded English
// labels on the admin side, and no theme toggle there at all. Anything that
// genuinely differs between the two is now a prop, so they cannot drift again.
//
// THE SIDEBAR FOLLOWS THE THEME (Favour, 14 Sep 2026). It was briefly dark in both
// themes, which mistook the dark mockup for an instruction; the mockup is the visual
// reference — spacing, hierarchy, the chip treatment — not a decision to pin one surface
// dark. Light mode: a paper sidebar one step lighter than the canvas behind it. Dark
// mode: #0f0f0f, one step deeper than the #141414 page. The same design, mirrored.
//
// Colours are written as literals rather than `bg-white` / `bg-brand-near-black` on
// purpose: globals.css carries unlayered `html.dark .bg-white {…}` overrides that would
// beat a `dark:` utility and silently undo the treatment below.
// =========================================================

export interface AppSidebarProps {
  nav: NavItem[];
  displayName: string;
  /** Small label under the logo — "Admin" on the admin shell, absent otherwise. */
  badge?: string;
  /** Line under the user's name. Links to /profile when a destination is given. */
  userCaptionKey?: Parameters<ReturnType<typeof useT>>[0];
  profileTo?: string;
  onLogout: () => void;
  /** Set by the mobile drawer so tapping a link closes it. */
  onNavigate?: () => void;
}

export function AppSidebar({
  nav, displayName, badge, userCaptionKey, profileTo, onLogout, onNavigate,
}: AppSidebarProps) {
  const t = useT();
  const initials = displayName
    .split(' ').slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  const user = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f2f1ee] text-[11px] font-bold text-[#0a0a0a] dark:bg-white/10 dark:text-white">
        {initials || <User className="size-3.5" />}
      </span>
      <div className="min-w-0 text-left">
        <p className="truncate text-xs font-semibold text-[#0a0a0a] dark:text-white">{displayName}</p>
        {userCaptionKey && (
          <p className="text-[10px] text-[#9a9a96] dark:text-white/50">{t(userCaptionKey)}</p>
        )}
      </div>
    </>
  );

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[#e4e3df] bg-[#ffffff] dark:border-white/10 dark:bg-[#0f0f0f]">
      <div className="border-b border-[#e4e3df] px-5 py-5 dark:border-white/10">
        <div className="flex flex-col leading-none">
          {/* The logo is the one thing that must invert with the surface, so it reads the
              theme rather than a prop. */}
          <span className="dark:hidden"><GroundworkLogo size="sm" variant="dark" /></span>
          <span className="hidden dark:block"><GroundworkLogo size="sm" variant="light" /></span>
          {badge && <span className="mt-0.5 text-[10px] text-[#9a9a96] dark:text-white/50">{badge}</span>}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {nav.map(({ to, labelKey, icon: Icon, exact, section }, i) => (
          <Fragment key={to}>
            {/* A heading above the first item of each section. The client nav has no
                sections and renders exactly as before. */}
            {section && nav[i - 1]?.section !== section && (
              <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a96] first:mt-0 dark:text-white/40">
                {t(section)}
              </p>
            )}
            <NavLink
              to={to}
              end={exact}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[#0a0a0a] text-white dark:bg-white dark:text-[#0a0a0a]'
                    : 'text-[#5a5a57] hover:bg-[#f7f7f5] hover:text-[#0a0a0a] dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {t(labelKey)}
            </NavLink>
          </Fragment>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-[#e4e3df] px-3 py-4 dark:border-white/10">
        {profileTo ? (
          <Link
            to={profileTo}
            onClick={onNavigate}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#f7f7f5] dark:hover:bg-white/10"
          >
            {user}
          </Link>
        ) : (
          <div className="flex w-full items-center gap-2.5 px-3 py-2.5">{user}</div>
        )}
        <LanguageToggle />
        <ThemeToggle />
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[#5a5a57] transition-colors hover:bg-[#f7f7f5] hover:text-[#0a0a0a] dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <LogOut className="size-4 shrink-0" />
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}
