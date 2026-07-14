import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FolderOpen, Users, ClipboardCheck, HardHat, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface Stats {
  totalProjects: number;
  pendingReviews: number;
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
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const [projects, reviews, users] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.from('project_stages').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);

      let pendingContractors = 0;
      try {
        const { count } = await supabase
          .from('contractors')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingContractors = count ?? 0;
      } catch { /* contractors table may not exist */ }

      setStats({
        totalProjects:   projects.count ?? 0,
        pendingReviews:  reviews.count  ?? 0,
        totalUsers:      users.count    ?? 0,
        pendingContractors,
      });
    }
    load();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-near-black">Admin Overview</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">Groundwork platform summary</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <StatCard
          label="Total Projects"
          value={stats?.totalProjects ?? null}
          icon={FolderOpen}
          to="/admin/projects"
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="Pending Reviews"
          value={stats?.pendingReviews ?? null}
          icon={ClipboardCheck}
          to="/admin/reviews"
          color={stats?.pendingReviews ? 'bg-amber-50 text-amber-600' : 'bg-brand-off-white text-brand-mid-grey'}
        />
        <StatCard
          label="Total Users"
          value={stats?.totalUsers ?? null}
          icon={Users}
          to="/admin/users"
          color="bg-green-50 text-green-600"
        />
        <StatCard
          label="Pending Contractors"
          value={stats?.pendingContractors ?? null}
          icon={HardHat}
          to="/admin/contractors"
          color={stats?.pendingContractors ? 'bg-purple-50 text-purple-600' : 'bg-brand-off-white text-brand-mid-grey'}
        />
      </div>
    </div>
  );
}
