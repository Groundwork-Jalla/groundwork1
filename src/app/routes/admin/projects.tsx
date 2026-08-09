import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, ExternalLink, Search, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useDomainLabels } from '@/lib/domain-labels';

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

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  on_hold:   'bg-amber-50 text-amber-700',
  completed: 'bg-brand-off-white text-brand-mid-grey',
  archived:  'bg-brand-off-white text-brand-mid-grey',
};

export default function AdminProjects() {
  const labels = useDomainLabels();
  const [assignTarget, setAssignTarget] = useState<AdminProject | null>(null);
  const [assignEmail,  setAssignEmail]  = useState('');
  const [assigning,    setAssigning]    = useState(false);
  const [assignError,  setAssignError]  = useState<string | null>(null);
  const [assignDone,   setAssignDone]   = useState<string | null>(null);

  /**
   * Puts a contractor on a client's project.
   *
   * Goes through the admin_assign_contractor RPC rather than writing the table
   * directly: contractor_invites is scoped to the project owner by RLS, and an
   * admin is not the owner. The RPC re-checks is_admin() server-side and writes an
   * audit row, so this cannot be driven from the console by a signed-in client.
   */
  async function handleAssign() {
    if (!assignTarget || !assignEmail.trim()) return;
    setAssigning(true);
    setAssignError(null);
    const { error } = await supabase.rpc('admin_assign_contractor', {
      p_project_id: assignTarget.id,
      p_email: assignEmail.trim(),
    });
    setAssigning(false);
    if (error) { setAssignError(error.message); return; }
    setAssignDone(`${assignEmail.trim()} → ${assignTarget.name}`);
    setAssignTarget(null);
  }
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
                  <td className="px-4 py-3 text-brand-mid-grey">{labels.tier(p.tier)}</td>
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
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setAssignTarget(p); setAssignEmail(''); setAssignError(null); }}
                        className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
                        title="Assign contractor"
                      >
                        <UserPlus className="size-4" />
                      </button>
                      <Link
                        to={`/projects/${p.id}`}
                        target="_blank"
                        className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
                        title="View project"
                      >
                        <ExternalLink className="size-4" />
                      </Link>
                    </div>
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

      {assignDone && (
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5 text-xs text-brand-near-black">
          Assigned {assignDone}. It now appears in the owner's Team tab.
        </p>
      )}

      {assignTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAssignTarget(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-6"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-sm font-bold text-brand-near-black">Assign a contractor</h2>
            <p className="mt-1 text-xs text-brand-mid-grey">
              Adds them to <span className="font-medium text-brand-near-black">{assignTarget.name}</span> and
              shows them in the owner's Team tab straight away — no invite email, no acceptance step.
            </p>

            <input
              type="email"
              autoFocus
              value={assignEmail}
              onChange={e => setAssignEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAssign(); }}
              placeholder="contractor@example.com"
              aria-label="Contractor email"
              className="mt-4 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
            />

            {assignError && (
              <p className="mt-2 text-xs text-state-alert" role="alert">{assignError}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={assigning || !assignEmail.trim()}
                className="flex-1 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
