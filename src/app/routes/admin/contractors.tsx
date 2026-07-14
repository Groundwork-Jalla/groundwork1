import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface ContractorApp {
  id: string;
  fullName: string;
  email: string;
  trade: string;
  yearsExperience: number;
  city: string;
  country: string;
  status: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-green-50 text-green-700 border border-green-200',
  rejected: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey',
};

export default function AdminContractors() {
  const [apps, setApps]       = useState<ContractorApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState('');
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('contractors')
          .select('id, full_name, email, trade, years_experience, city, country, status, created_at')
          .order('created_at', { ascending: false });
        setApps((data ?? []).map((c: Record<string, unknown>) => ({
          id:              c.id as string,
          fullName:        c.full_name as string ?? '',
          email:           c.email as string ?? '',
          trade:           c.trade as string ?? '',
          yearsExperience: c.years_experience as number ?? 0,
          city:            c.city as string ?? '',
          country:         c.country as string ?? '',
          status:          c.status as string ?? 'pending',
          createdAt:       c.created_at as string,
        })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleAction(id: string, status: 'approved' | 'rejected') {
    setActioning(id);
    await supabase.from('contractors').update({ status }).eq('id', id);
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    setActioning(null);
  }

  const filtered = query
    ? apps.filter(a =>
        a.fullName.toLowerCase().includes(query.toLowerCase()) ||
        a.email.toLowerCase().includes(query.toLowerCase()) ||
        a.trade.toLowerCase().includes(query.toLowerCase()),
      )
    : apps;

  const pending = filtered.filter(a => a.status === 'pending');
  const rest    = filtered.filter(a => a.status !== 'pending');

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">Contractor Applications</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            {apps.filter(a => a.status === 'pending').length} pending · {apps.length} total
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey" />
          <input
            type="text"
            placeholder="Search applicants..."
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
        <div className="flex flex-col gap-4">
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-mid-grey mb-3">
                Pending review ({pending.length})
              </h2>
              <div className="flex flex-col gap-3">
                {pending.map(a => (
                  <ApplicationCard
                    key={a.id}
                    app={a}
                    actioning={actioning === a.id}
                    onAction={handleAction}
                  />
                ))}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-mid-grey mb-3 mt-4">
                Reviewed ({rest.length})
              </h2>
              <div className="flex flex-col gap-3">
                {rest.map(a => (
                  <ApplicationCard key={a.id} app={a} actioning={false} onAction={handleAction} />
                ))}
              </div>
            </section>
          )}
          {filtered.length === 0 && (
            <p className="text-sm text-brand-mid-grey py-8 text-center">No applications found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({
  app, actioning, onAction,
}: {
  app: ContractorApp;
  actioning: boolean;
  onAction: (id: string, status: 'approved' | 'rejected') => void;
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[app.status] ?? ''}`}>
            {app.status}
          </span>
        </div>
        <p className="font-semibold text-brand-near-black">{app.fullName}</p>
        <p className="text-xs text-brand-mid-grey">{app.email}</p>
        <p className="text-xs text-brand-mid-grey mt-1">
          {app.trade} · {app.yearsExperience} yr{app.yearsExperience !== 1 ? 's' : ''} exp
          {app.city ? ` · ${app.city}, ${app.country}` : ` · ${app.country}`}
        </p>
        <p className="text-[10px] text-brand-mid-grey mt-1">
          Applied {new Date(app.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>

      {app.status === 'pending' && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={actioning}
            onClick={() => onAction(app.id, 'rejected')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-brand-border-grey rounded-xl text-brand-mid-grey hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {actioning ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3.5" />}
            Reject
          </button>
          <button
            type="button"
            disabled={actioning}
            onClick={() => onAction(app.id, 'approved')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-near-black text-white rounded-xl hover:bg-black transition-colors disabled:opacity-50"
          >
            {actioning ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle className="size-3.5" />}
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
