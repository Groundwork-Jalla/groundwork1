import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import {
  LayoutDashboard, ClipboardCheck, FolderOpen,
  Users, HardHat, LogOut,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/admin',              label: 'Overview',    icon: LayoutDashboard, end: true },
  { to: '/admin/reviews',      label: 'Reviews',     icon: ClipboardCheck },
  { to: '/admin/projects',     label: 'Projects',    icon: FolderOpen },
  { to: '/admin/users',        label: 'Users',       icon: Users },
  { to: '/admin/contractors',  label: 'Contractors', icon: HardHat },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, session, loading, signOut } = useAuth();

  const isAdmin = user?.user_metadata?.role === 'admin';

  useEffect(() => {
    if (loading) return;
    if (!session) { navigate('/auth/login', { replace: true }); return; }
    if (!isAdmin) { navigate('/dashboard', { replace: true }); }
  }, [loading, session, isAdmin, navigate]);

  if (loading || !session || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-brand-off-white font-sans">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-brand-border-grey bg-white">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-brand-border-grey">
          <div className="flex flex-col leading-none">
            <GroundworkLogo size="md" showByline={false} />
            <span className="text-[10px] text-brand-mid-grey mt-0.5">Admin</span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-near-black text-white'
                    : 'text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer: user + logout */}
        <div className="px-3 py-4 border-t border-brand-border-grey">
          <div className="px-3 mb-2">
            <p className="text-xs font-medium text-brand-near-black truncate">
              {user?.user_metadata?.full_name ?? user?.email}
            </p>
            <p className="text-[10px] text-brand-mid-grey">Admin</p>
          </div>
          <button
            type="button"
            onClick={async () => { await signOut(); navigate('/'); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
          >
            <LogOut className="size-4 shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
