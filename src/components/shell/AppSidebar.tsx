import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronRight, LogOut, User } from 'lucide-react';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { NavItem } from './nav-config';
import { activeNavItem, navGroups, OPEN_GROUPS_KEY } from './nav-groups';

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
  appearance?: 'default' | 'calm';
}

export function AppSidebar({
  nav, displayName, badge, userCaptionKey, profileTo, onLogout, onNavigate, appearance = 'default',
}: AppSidebarProps) {
  const t = useT();
  const calm = appearance === 'calm';
  const location = useLocation();
  // One lit item, by the whole address: /admin/inbox and /admin/inbox?channel=whatsapp are
  // different destinations, and NavLink's own check ignores the ?, which lit all five
  // Communication items at once (18 Nov).
  const activeTo = activeNavItem(nav, location.pathname, location.search);
  const groups = useMemo(() => navGroups(nav), [nav]);
  const activeGroup = groups.find(group => group.items.some(item => item.to === activeTo))?.section ?? null;
  // Dropdown groups (Favour, 18 Nov): the group holding the current page is open; any other
  // opens on a click and stays open for this browser. Read after mount, so the server and
  // the first client render agree.
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OPEN_GROUPS_KEY) ?? '[]');
      if (Array.isArray(saved)) setOpen(prev => new Set([...prev, ...saved.filter((v): v is string => typeof v === 'string')]));
    } catch { /* No storage: groups simply start closed. */ }
  }, []);
  useEffect(() => { if (activeGroup) setOpen(prev => prev.has(activeGroup) ? prev : new Set([...prev, activeGroup])); }, [activeGroup]);
  const toggle = (section: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(section)) next.delete(section); else next.add(section);
    try { window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...next])); } catch { /* Not remembered; still toggles. */ }
    return next;
  });
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
      <div className={cn('border-b border-[#e4e3df] px-5 dark:border-white/10', calm ? 'py-6' : 'py-5')}>
        <div className="flex flex-col leading-none">
          {/* Keep the wordmark legible against either the home sidebar or the default shell. */}
          {calm ? <GroundworkLogo size="xl" variant="green" /> : <>
            <span className="dark:hidden"><GroundworkLogo size="sm" variant="dark" /></span>
            <span className="hidden dark:block"><GroundworkLogo size="sm" variant="light" /></span>
          </>}
          {badge && <span className="mt-0.5 text-[10px] text-[#9a9a96] dark:text-white/50">{badge}</span>}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {groups.map(group => {
          const links = group.items.map(({ to, labelKey, icon: Icon }) => {
            const isActive = to === activeTo;
            return (
              <Fragment key={to}>
                {calm && to === '/profile' && <div aria-hidden className="mt-auto border-t border-brand-border-grey pt-2" />}
                <Link
                  to={to}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    calm
                      ? isActive ? 'bg-brand-green/8 text-brand-green dark:bg-white/10 dark:text-[#b4d8bf]' : 'text-[#5a5a57] hover:bg-[#f7f7f5] hover:text-[#0a0a0a] dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white'
                      : isActive
                      ? 'bg-brand-green text-white'
                      : 'text-[#5a5a57] hover:bg-[#f7f7f5] hover:text-[#0a0a0a] dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', to.includes('channel=whatsapp') && 'text-[#25D366]')} />
                  {t(labelKey)}
                </Link>
              </Fragment>
            );
          });
          // The client nav has no sections and renders exactly as before; so do the
          // admin's Overview group and its one-item groups (Support, Analytics).
          if (!group.section || !group.collapsible) return <Fragment key={group.key}>{group.section && group.key !== groups[0].key && <div aria-hidden className="h-2" />}{links}</Fragment>;
          const expanded = open.has(group.section);
          const id = `nav-group-${group.key}`;
          return (
            <div key={group.key} className="mt-1">
              <button type="button" onClick={() => toggle(group.section!)} aria-expanded={expanded} aria-controls={id} data-nav-group={group.section}
                className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-[#f7f7f5] dark:hover:bg-white/10',
                  expanded || group.section === activeGroup ? 'text-brand-green dark:text-[#b4d8bf]' : 'text-[#0a0a0a] dark:text-white')}>
                <span className="flex-1">{t(group.section)}</span>
                <span className="font-mono text-[11px] font-normal text-[#9a9a96] dark:text-white/40">{group.items.length}</span>
                <ChevronRight aria-hidden className={cn('size-3.5 text-[#9a9a96] transition-transform dark:text-white/40', expanded && 'rotate-90')} />
              </button>
              {expanded && <div id={id} className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[#e4e3df] pl-2 dark:border-white/10">{links}</div>}
            </div>
          );
        })}
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
