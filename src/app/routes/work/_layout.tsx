import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { HardHat, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /work — the contractor's execution surface.
//
// ── The door is the ASSIGNMENT, not a privilege ──────────────────────────────────────
// A contractor is someone holding at least one accepted `contractor_invites` row. That is
// exactly what `is_contractor_on()` checks inside every RLS policy behind this surface
// (086), so the gate asks the same question the rooms do — a door opening onto reads that
// then refuse would be worse than no door.
//
// An admin is NOT admitted for being an admin. /admin oversees, /work executes; an
// operator with no site work here has nothing to do and is sent back. Someone who is both
// an operator and a real contractor is admitted, because they hold the assignment.
//
// Nothing below queries every project and narrows it in the browser: RLS returns only the
// contractor's projects, so a mistake here is an inconvenience, not a disclosure.
// =========================================================

const TABS = [
  { to: '/work',          key: 'contractor.nav.dashboard', exact: true },
  { to: '/work/projects', key: 'contractor.nav.projects',  exact: false },
] as const;

export default function WorkLayout() {
  const { session, loading, isContractor, rolesChecked, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();

  const allowed = isContractor;
  const resolved = rolesChecked;

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    if (resolved && !allowed) navigate('/dashboard', { replace: true });
  }, [loading, session, resolved, allowed, navigate, location.pathname]);

  if (loading || !session || !resolved || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-off-white dark:bg-[#141414]">
        <Loader2 className="size-5 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  const displayName = (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split('@')[0]
    ?? '';
  const initials = displayName.trim().split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('');

  return (
    <div className="min-h-screen bg-brand-off-white dark:bg-[#141414]">
      <header className="border-b border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <Link to="/work" className="flex items-center gap-2">
            <HardHat className="size-4 text-brand-near-black dark:text-white" />
            <span className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t('contractor.surface.title')}
            </span>
          </Link>

          <nav className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
            {TABS.map(tab => {
              const active = tab.exact
                ? location.pathname === tab.to
                : location.pathname.startsWith(tab.to);
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
                      : 'text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]',
                  )}
                >
                  {t(tab.key)}
                </Link>
              );
            })}
          </nav>

          <div className="order-2 flex items-center gap-2 sm:order-3">
            <LanguageToggle />
            <ThemeToggle />
            {initials && (
              <span
                title={displayName}
                className="flex size-7 items-center justify-center rounded-full bg-brand-off-white text-[11px] font-semibold text-brand-near-black dark:bg-[#2c2c2c] dark:text-white"
              >
                {initials}
              </span>
            )}
            <button
              type="button"
              onClick={async () => { await signOut(); navigate('/', { replace: true }); }}
              aria-label={t('common.logOut')}
              className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#2c2c2c]"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
