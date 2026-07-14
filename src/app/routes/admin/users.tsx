import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  tier: string;
  role: string;
  createdAt: string;
}

const TIER_LABELS: Record<string, string> = {
  self_verify: 'Self Verify', jalla_verify: 'Jalla Verify', jalla_management: 'Jalla Management',
  starter: 'Self Verify', pro: 'Jalla Verify', enterprise: 'Jalla Management',
};

const ROLE_STYLES: Record<string, string> = {
  admin:      'bg-purple-50 text-purple-700',
  contractor: 'bg-blue-50 text-blue-700',
  homeowner:  'bg-green-50 text-green-700',
};

export default function AdminUsers() {
  const [users, setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, email, full_name, tier, role, created_at')
          .order('created_at', { ascending: false });
        setUsers((data ?? []).map((u: Record<string, unknown>) => ({
          id:        u.id as string,
          email:     u.email as string ?? '',
          fullName:  u.full_name as string ?? '',
          tier:      u.tier as string ?? '',
          role:      u.role as string ?? 'homeowner',
          createdAt: u.created_at as string,
        })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = query
    ? users.filter(u =>
        u.email.toLowerCase().includes(query.toLowerCase()) ||
        u.fullName.toLowerCase().includes(query.toLowerCase()),
      )
    : users;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">All Users</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{users.length} registered</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey" />
          <input
            type="text"
            placeholder="Search users..."
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
                {['Name', 'Email', 'Role', 'Plan', 'Joined', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-brand-off-white transition-colors">
                  <td className="px-4 py-3 font-medium text-brand-near-black max-w-[160px] truncate">
                    {u.fullName || '—'}
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey max-w-[200px] truncate">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ROLE_STYLES[u.role] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey">{TIER_LABELS[u.tier] ?? (u.tier || '—')}</td>
                  <td className="px-4 py-3 text-brand-mid-grey text-xs">
                    {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-brand-mid-grey">{u.id.slice(0, 8)}…</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-brand-mid-grey">
                    No users match "{query}"
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
