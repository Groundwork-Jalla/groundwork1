import { useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, User } from 'lucide-react';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AppSidebar } from './AppSidebar';
import { pageTitleKey, type NavItem } from './nav-config';

// =========================================================
// The signed-in chrome: sidebar + top bar + mobile drawer + mobile tab bar.
//
// Both the client and the admin area render this. Before, only the client had a
// mobile drawer, a tab bar and a top bar — the admin sidebar simply vanished
// below `md`, leaving the admin area unusable on a phone with no way to
// navigate. Sharing the shell fixes that as a side effect of not duplicating it.
// =========================================================

export interface AppShellProps {
  nav: NavItem[];
  displayName: string;
  onLogout: () => void;
  badge?: string;
  profileTo?: string;
  userCaptionKey?: AppShellPropsCaption;
  /** Rendered at the right of the top bar — the notification bell, avatar, etc. */
  topBarActions?: ReactNode;
  children: ReactNode;
}
type AppShellPropsCaption = Parameters<ReturnType<typeof useT>>[0];

export function AppShell({
  nav, displayName, onLogout, badge, profileTo, userCaptionKey, topBarActions, children,
}: AppShellProps) {
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  const t = useT();

  const sidebar = (onNavigate?: () => void) => (
    <AppSidebar
      nav={nav}
      displayName={displayName}
      badge={badge}
      profileTo={profileTo}
      userCaptionKey={userCaptionKey}
      onLogout={onLogout}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-brand-off-white font-sans">

      <div className="hidden shrink-0 md:block">{sidebar()}</div>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.div
              className="fixed bottom-0 left-0 top-0 z-50 md:hidden"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              {sidebar(() => setDrawer(false))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        <header className="flex h-14 shrink-0 items-center justify-between border-b border-brand-border-grey bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={t('nav.mainNavigation')}
              className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-brand-off-white md:hidden"
              onClick={() => setDrawer(true)}
            >
              <Menu className="size-5 text-brand-near-black" />
            </button>
            <div className="md:hidden"><GroundworkLogo size="sm" /></div>
            <h1 className="hidden text-sm font-semibold text-brand-near-black md:block">
              {t(pageTitleKey(pathname, nav))}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageToggle compact />
            <ThemeToggle compact />
            {topBarActions}
            {profileTo && (
              <Link
                to={profileTo}
                className="flex size-8 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold text-brand-near-black transition-colors hover:bg-brand-border-grey"
              >
                {displayName.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
                  || <User className="size-3.5" />}
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>

        {/* Mobile tab bar — the first five destinations, mirroring the sidebar. */}
        <nav className="flex shrink-0 items-center border-t border-brand-border-grey bg-white md:hidden">
          {nav.slice(0, 5).map(({ to, labelKey, shortKey, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-brand-near-black' : 'text-brand-mid-grey',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('size-5', isActive && 'stroke-[2.2]')} />
                  {t(shortKey ?? labelKey)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
