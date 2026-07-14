import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, ExternalLink, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface AdminProject {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  tier: string;
  status: string;
  currentStage: number;
  country: string;
  createdAt: string;
}

const TIER_LABELS: Record<string, string> = {
  self_verify: 'Self Verify', jalla_verify: 'Jalla Verify', enterprise_custom: 'Enterprise Custom',
  starter: 'Self Verify', pro: 'Jalla Verify', enterprise: 'Enterprise Custom', jalla_management: 'Enterprise Custom',
};

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  on_hold:   'bg-amber-50 text-amber-700',
  completed: 'bg-brand-off-white text-brand-mid-grey',
  archived:  'bg-brand-off-white text-brand-mid-grey',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('projects')
          .select(`id, name, tier, status, current_stage, country, created_at,
                   profiles!inner(full_name, email)`)
          .order('created_at', { ascending: false });
        setProjects((data ?? []).map((p: Record<string, unknown>) => {
          const profile = p.profiles as Record<string, unknown>;
          return {
            id:           p.id as string,
            name:         p.name as string,
            ownerEmail:   profile?.email as string ?? '',
            ownerName:    profile?.full_name as string ?? '',
            tier:         p.tier as string,
            status:       p.status as string,
            currentStage: p.current_stage as number,
            country:      p.country as string,
            createdAt:    p.created_at as string,
          };
        }));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = query
    ? projects.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.ownerEmail.toLowerCase().includes(query.toLowerCase()) ||
        p.ownerName.toLowerCase().includes(query.toLowerCase()),
      )
    : projects;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">All Projects</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{projects.length} total</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey" />
          <input
            type="text"
            placeholder="Search projects..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-brand-border-grey rounded-xl outline-none focus:ring-2 focus:ring-brand-near-black/20 bg-white w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-border-grey overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border-grey bg-brand-off-white">
              <tr>
                {['Project', 'Owner', 'Tier', 'Status', 'Stage', 'Created', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-brand-off-white transition-colors">
                  <td className="px-4 py-3 font-medium text-brand-near-black max-w-[200px] truncate">{p.name}</td>
                  <td className="px-4 py-3 text-brand-mid-grey max-w-[160px] truncate">
                    <span title={p.ownerEmail}>{p.ownerName || p.ownerEmail}</span>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey">{TIER_LABELS[p.tier] ?? p.tier}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[p.status] ?? ''}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey tabular-nums">{p.currentStage} / 10</td>
                  <td className="px-4 py-3 text-brand-mid-grey text-xs">
                    {new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/projects/${p.id}`}
                      target="_blank"
                      className="text-brand-mid-grey hover:text-brand-near-black transition-colors"
                      title="View project"
                    >
                      <ExternalLink className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-brand-mid-grey">
                    No projects match "{query}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
