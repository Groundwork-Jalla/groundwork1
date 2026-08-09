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
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold text-brand-near-black">
        {initials || <User className="size-3.5" />}
      </span>
      <div className="min-w-0 text-left">
        <p className="truncate text-xs font-semibold text-brand-near-black">{displayName}</p>
        {userCaptionKey && (
          <p className="text-[10px] text-brand-mid-grey">{t(userCaptionKey)}</p>
        )}
      </div>
    </>
  );

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-brand-border-grey bg-white">
      <div className="border-b border-brand-border-grey px-5 py-5">
        <div className="flex flex-col leading-none">
          <GroundworkLogo size="sm" />
          {badge && <span className="mt-0.5 text-[10px] text-brand-mid-grey">{badge}</span>}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {nav.map(({ to, labelKey, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-near-black text-white'
                  : 'text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-brand-border-grey px-3 py-4">
        {profileTo ? (
          <Link
            to={profileTo}
            onClick={onNavigate}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-off-white"
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
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black"
        >
          <LogOut className="size-4 shrink-0" />
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}
