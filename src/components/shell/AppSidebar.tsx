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
  /**
   * `dark`: the sidebar stays dark in both themes — the admin's treatment (design
   * reference: the dark concept in docs/admin, 13 Sep 2026). The content area still
   * follows the theme toggle. `light` (default): follows the theme like everything else.
   */
  tone?: 'light' | 'dark';
}

export function AppSidebar({
  nav, displayName, badge, userCaptionKey, profileTo, onLogout, onNavigate, tone = 'light',
}: AppSidebarProps) {
  const t = useT();
  const onDark = tone === 'dark';
  const initials = displayName
    .split(' ').slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  const user = (
    <>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
        onDark ? 'bg-white/10 text-white' : 'bg-brand-light-grey text-brand-near-black')}>
        {initials || <User className="size-3.5" />}
      </span>
      <div className="min-w-0 text-left">
        <p className={cn('truncate text-xs font-semibold', onDark ? 'text-white' : 'text-brand-near-black')}>{displayName}</p>
        {userCaptionKey && (
          <p className={cn('text-[10px]', onDark ? 'text-white/50' : 'text-brand-mid-grey')}>{t(userCaptionKey)}</p>
        )}
      </div>
    </>
  );

  return (
    <aside className={cn('flex h-full w-56 shrink-0 flex-col border-r',
      onDark ? 'border-white/10 bg-[#0f0f0f]' : 'border-brand-border-grey bg-white')}>
      <div className={cn('px-5 py-5 border-b', onDark ? 'border-white/10' : 'border-brand-border-grey')}>
        <div className="flex flex-col leading-none">
          <GroundworkLogo size="sm" variant={onDark ? 'light' : 'dark'} />
          {badge && <span className={cn('mt-0.5 text-[10px]', onDark ? 'text-white/50' : 'text-brand-mid-grey')}>{badge}</span>}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {nav.map(({ to, labelKey, icon: Icon, exact, section }, i) => (
          <Fragment key={to}>
            {/* A heading above the first item of each section. The client nav has no
                sections and renders exactly as before. */}
            {section && nav[i - 1]?.section !== section && (
              <p className={cn('mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-wide first:mt-0',
                onDark ? 'text-white/40' : 'text-brand-mid-grey')}>
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
                  onDark
                    ? isActive
                      ? 'bg-white text-brand-near-black'
                      : 'text-white/65 hover:bg-white/10 hover:text-white'
                    : isActive
                      ? 'bg-brand-near-black text-white'
                      : 'text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {t(labelKey)}
            </NavLink>
          </Fragment>
        ))}
      </nav>

      <div className={cn('space-y-0.5 border-t px-3 py-4', onDark ? 'border-white/10' : 'border-brand-border-grey')}>
        {profileTo ? (
          <Link
            to={profileTo}
            onClick={onNavigate}
            className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors', onDark ? 'hover:bg-white/10' : 'hover:bg-brand-off-white')}
          >
            {user}
          </Link>
        ) : (
          <div className="flex w-full items-center gap-2.5 px-3 py-2.5">{user}</div>
        )}
        <LanguageToggle onDark={onDark} />
        <ThemeToggle onDark={onDark} />
        <button
          type="button"
          onClick={onLogout}
          className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors',
            onDark ? 'text-white/65 hover:bg-white/10 hover:text-white' : 'text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black')}
        >
          <LogOut className="size-4 shrink-0" />
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}
