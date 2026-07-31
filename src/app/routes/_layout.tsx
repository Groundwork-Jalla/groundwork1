import { useEffect, useState } from "react";
import { Outlet, NavLink, Link, useNavigate, useLocation } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { GroundworkLogo } from "@/components/ui/GroundworkLogo";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useT, type TKey } from "@/lib/i18n";
import {
  LayoutDashboard, FolderOpen, BookOpen, HardHat,
  CreditCard, Bell, Settings, Menu, LogOut, User, FolderArchive,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Navigation config ──────────────────────────────────────

const NAV: { to: string; labelKey: TKey; shortKey?: TKey; icon: typeof LayoutDashboard; exact: boolean }[] = [
  { to: "/dashboard",     labelKey: "nav.dashboard",     icon: LayoutDashboard, exact: true  },
  { to: "/projects",      labelKey: "nav.myProjects", shortKey: "nav.projects", icon: FolderOpen, exact: false },
  { to: "/documents",     labelKey: "nav.documents",     icon: FolderArchive,   exact: false },
  { to: "/resources",     labelKey: "nav.resources",     icon: BookOpen,        exact: false },
  { to: "/contractors",   labelKey: "nav.contractors",   icon: HardHat,         exact: false },
  { to: "/payments",      labelKey: "nav.payments",      icon: CreditCard,      exact: false },
  { to: "/notifications", labelKey: "nav.notifications", icon: Bell,            exact: false },
  { to: "/profile",       labelKey: "nav.settings",      icon: Settings,        exact: true  },
];

function getPageTitleKey(pathname: string): TKey {
  if (pathname === "/dashboard")               return "nav.dashboard";
  if (pathname.startsWith("/projects"))        return "nav.myProjects";
  if (pathname.startsWith("/documents"))       return "nav.documents";
  if (pathname.startsWith("/resources"))       return "nav.resources";
  if (pathname.startsWith("/contractors"))     return "nav.contractors";
  if (pathname.startsWith("/payments"))        return "nav.payments";
  if (pathname.startsWith("/upgrade"))         return "nav.upgradePlan";
  if (pathname.startsWith("/notifications"))   return "nav.notifications";
  if (pathname.startsWith("/profile"))         return "nav.settings";
  return "nav.groundwork";
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

// ── Sidebar ────────────────────────────────────────────────

function Sidebar({
  displayName, onLogout, onClose,
}: {
  displayName: string; onLogout: () => void; onClose?: () => void;
}) {
  const t = useT();

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-brand-border-grey bg-white h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-brand-border-grey">
        <GroundworkLogo size="sm" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ to, labelKey, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors w-full",
                isActive
                  ? "bg-brand-near-black text-white"
                  : "text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white",
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-brand-border-grey space-y-0.5">
        <Link
          to="/profile"
          onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-brand-off-white transition-colors w-full"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold text-brand-near-black">
            {getInitials(displayName) || <User className="size-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-near-black truncate">{displayName}</p>
            <p className="text-[10px] text-brand-mid-grey">{t('nav.viewProfile')}</p>
          </div>
        </Link>
        <LanguageToggle />
        <ThemeToggle />
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}

// ── Protected layout ───────────────────────────────────────

export default function ProtectedLayout() {
  const navigate         = useNavigate();
  const { pathname }     = useLocation();
  const { user, session, loading, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!loading && !session) navigate("/auth/login", { replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split("@")[0]
    ?? "You";
  const pageTitle = t(getPageTitleKey(pathname));

  async function handleLogout() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-brand-off-white font-sans">

      {/* Desktop sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar displayName={displayName} onLogout={handleLogout} />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.div
              className="fixed left-0 top-0 bottom-0 z-50 md:hidden"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              <Sidebar
                displayName={displayName}
                onLogout={handleLogout}
                onClose={() => setDrawer(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header className="h-14 border-b border-brand-border-grey bg-white flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden flex size-8 items-center justify-center rounded-lg hover:bg-brand-off-white transition-colors"
              onClick={() => setDrawer(true)}
            >
              <Menu className="size-5 text-brand-near-black" />
            </button>
            <div className="md:hidden">
              <GroundworkLogo size="sm" />
            </div>
            <h1 className="hidden md:block text-sm font-semibold text-brand-near-black">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageToggle compact />
            <ThemeToggle compact />
            <NotificationBell userId={user?.id ?? ""} />
            <Link
              to="/profile"
              className="flex size-8 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold text-brand-near-black hover:bg-brand-border-grey transition-colors"
            >
              {getInitials(displayName) || <User className="size-3.5" />}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden border-t border-brand-border-grey bg-white flex items-center shrink-0">
          {NAV.slice(0, 5).map(({ to, labelKey, shortKey, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                  isActive ? "text-brand-near-black" : "text-brand-mid-grey",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-5", isActive && "stroke-[2.2]")} />
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
