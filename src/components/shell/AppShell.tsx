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
  /** Rendered beside the page title — the admin's global search. */
  topBarSearch?: ReactNode;
  children: ReactNode;
}
type AppShellPropsCaption = Parameters<ReturnType<typeof useT>>[0];

export function AppShell({
  nav, displayName, onLogout, badge, profileTo, userCaptionKey, topBarActions, topBarSearch, children,
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
    <div className="flex h-screen overflow-hidden bg-[#f7f7f5] font-sans dark:bg-[#141414]">

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

        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#e4e3df] bg-[#ffffff] px-4 dark:border-[#2c2c2c] dark:bg-[#161616] sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              aria-label={t('nav.mainNavigation')}
              className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-[#f7f7f5] dark:hover:bg-white/10 md:hidden"
              onClick={() => setDrawer(true)}
            >
              <Menu className="size-5 text-[#0a0a0a] dark:text-white" />
            </button>
            <div className="md:hidden"><GroundworkLogo size="sm" /></div>
            <h1 className="hidden shrink-0 text-sm font-semibold text-[#0a0a0a] dark:text-white md:block">
              {t(pageTitleKey(pathname, nav))}
            </h1>
            {topBarSearch}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageToggle compact />
            <ThemeToggle compact />
            {topBarActions}
            {profileTo && (
              <Link
                to={profileTo}
                className="flex size-8 items-center justify-center rounded-full bg-[#f2f1ee] text-[11px] font-bold text-[#0a0a0a] transition-colors hover:bg-[#e4e3df] dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
              >
                {displayName.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
                  || <User className="size-3.5" />}
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>

        {/* Mobile tab bar — the first five destinations, mirroring the sidebar. */}
        <nav className="flex shrink-0 items-center border-t border-[#e4e3df] bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#0f0f0f] md:hidden">
          {nav.slice(0, 5).map(({ to, labelKey, shortKey, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-[#0a0a0a] dark:text-white' : 'text-[#5a5a57] dark:text-white/55',
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
