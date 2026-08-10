import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FolderOpen, Users, ClipboardCheck, HardHat, ChevronRight, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { listAdminUsers } from '@/lib/supabase/admin-users';
import { useT } from '@/lib/i18n';

interface Stats {
  totalProjects: number;
  pendingReviews: number;
  pendingBudgets: number;
  totalUsers: number;
  pendingContractors: number;
}

function StatCard({
  label, value, icon: Icon, to, color,
}: {
  label: string; value: number | null; icon: React.ElementType; to: string; color: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all"
    >
      <div>
        <p className="text-xs text-brand-mid-grey mb-1">{label}</p>
        <p className="text-3xl font-black text-brand-near-black tabular-nums">
          {value === null ? '—' : value}
        </p>
      </div>
      <div className={`flex size-10 items-center justify-center rounded-xl ${color}`}>
        <Icon className="size-5" />
      </div>
      <ChevronRight className="size-4 text-brand-mid-grey group-hover:text-brand-near-black transition-colors ml-2" />
    </Link>
  );
}

export default function AdminOverview() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const [projects, reviews, budgets] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.from('project_stages').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
        supabase.from('projects').select('id', { count: 'exact', head: true })
          .in('tier', ['jalla_management', 'enterprise']).is('tracking_started_at', null),
      ]);

      // Counted from the same source as /admin/users, so the card and the page agree.
      // `profiles` under-reports: it had 3 rows against 6 auth users.
      let totalUsers = 0;
      try { totalUsers = (await listAdminUsers()).length; } catch { /* stays 0 */ }

      // Was `contractors.status = 'pending'`. That table is a public directory with no
      // `status` column, so the request 400'd on every load — and supabase-js resolves
      // errors rather than throwing, so the try/catch never caught anything. Pending
      // applications are the number this card was actually meant to show.
      let pendingContractors = 0;
      {
        const { count } = await supabase
          .from('contractor_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingContractors = count ?? 0;
      }

      setStats({
        totalProjects:   projects.count ?? 0,
        pendingReviews:  reviews.count  ?? 0,
        pendingBudgets:  budgets.count  ?? 0,
        totalUsers,
        pendingContractors,
      });
    }
    load();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.overviewTitle')}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.overviewSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <StatCard
          label={t('admin.totalProjects')}
          value={stats?.totalProjects ?? null}
          icon={FolderOpen}
          to="/admin/projects"
          color="bg-brand-off-white text-state-active"
        />
        <StatCard
          label={t('admin.pendingReviews')}
          value={stats?.pendingReviews ?? null}
          icon={ClipboardCheck}
          to="/admin/reviews"
          color={stats?.pendingReviews ? 'bg-brand-off-white text-state-held' : 'bg-brand-off-white text-brand-mid-grey'}
        />
        <StatCard
          label={t('admin.pendingBudgets')}
          value={stats?.pendingBudgets ?? null}
          icon={Wallet}
          to="/admin/budgets"
          color={stats?.pendingBudgets ? 'bg-brand-off-white text-state-held' : 'bg-brand-off-white text-brand-mid-grey'}
        />
        <StatCard
          label={t('admin.totalUsers')}
          value={stats?.totalUsers ?? null}
          icon={Users}
          to="/admin/users"
          color="bg-brand-off-white text-state-complete"
        />
        <StatCard
          label={t('admin.pendingContractors')}
          value={stats?.pendingContractors ?? null}
          icon={HardHat}
          to="/admin/contractors"
          color={stats?.pendingContractors ? 'bg-brand-off-white text-state-active' : 'bg-brand-off-white text-brand-mid-grey'}
        />
      </div>
    </div>
  );
}
