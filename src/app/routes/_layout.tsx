import { useEffect, useState } from "react";
import { Outlet, NavLink, Link, useNavigate, useLocation } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { GroundworkLogo } from "@/components/ui/GroundworkLogo";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard, FolderOpen, BookOpen, HardHat,
  CreditCard, Bell, Settings, Menu, LogOut, User, FolderArchive,
  Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Theme toggle ───────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return document.documentElement.classList.contains("dark");
  });

  function toggle() {
    setDark(prev => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

  return { dark, toggle };
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { dark, toggle } = useTheme();
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex size-8 items-center justify-center rounded-lg text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
    >
      {dark
        ? <Sun  className="size-4 shrink-0" />
        : <Moon className="size-4 shrink-0" />}
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

// ── Navigation config ──────────────────────────────────────

const NAV = [
  { to: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard, exact: true  },
  { to: "/projects",      label: "My Projects",   icon: FolderOpen,      exact: false },
  { to: "/documents",     label: "Documents",     icon: FolderArchive,   exact: false },
  { to: "/resources",     label: "Resources",     icon: BookOpen,        exact: false },
  { to: "/contractors",   label: "Contractors",   icon: HardHat,         exact: false },
  { to: "/payments",      label: "Payments",      icon: CreditCard,      exact: false },
  { to: "/notifications", label: "Notifications", icon: Bell,            exact: false },
  { to: "/profile",       label: "Settings",      icon: Settings,        exact: true  },
];

function getPageTitle(pathname: string): string {
  if (pathname === "/dashboard")               return "Dashboard";
  if (pathname.startsWith("/projects"))        return "My Projects";
  if (pathname.startsWith("/documents"))       return "Documents";
  if (pathname.startsWith("/resources"))       return "Resources";
  if (pathname.startsWith("/contractors"))     return "Contractors";
  if (pathname.startsWith("/payments"))        return "Payments";
  if (pathname.startsWith("/notifications"))   return "Notifications";
  if (pathname.startsWith("/profile"))         return "Settings";
  return "Groundwork";
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
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-brand-border-grey bg-white h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-brand-border-grey">
        <GroundworkLogo size="sm" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, exact }) => (
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
            {label}
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
            <p className="text-[10px] text-brand-mid-grey">View profile</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          Log out
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
  const pageTitle = getPageTitle(pathname);

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
          {NAV.slice(0, 5).map(({ to, label, icon: Icon, exact }) => (
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
                  {label === "My Projects" ? "Projects" : label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
