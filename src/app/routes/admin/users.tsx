import { useEffect, useState } from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { listAdminUsers, deleteUser, type AdminUser } from '@/lib/supabase/admin-users';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { useDomainLabels } from '@/lib/domain-labels';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';

const ROLE_STYLES: Record<string, string> = {
  admin:      'bg-brand-off-white text-state-active',
  contractor: 'bg-brand-off-white text-state-active',
  homeowner:  'bg-brand-off-white text-state-complete',
};

export default function AdminUsers() {
  const t = useT();
  const labels = useDomainLabels();
  const [users, setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [target, setTarget]   = useState<AdminUser | null>(null);
  const [busy, setBusy]       = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  async function confirmDelete() {
    if (!target) return;
    setBusy(true); setDelError(null);
    try {
      const destroyed = await deleteUser(target.id);
      setUsers(prev => prev.filter(u => u.id !== target.id));
      setNotice(destroyed > 0
        ? t('admin.del.deletedWithProjects', { count: destroyed })
        : t('admin.del.deleted'));
      setTarget(null);
    } catch (err) {
      // The guards live in the database, so their messages are the authoritative ones.
      const msg = errorMessage(err, '');
      setDelError(
        msg.includes('self_delete') ? t('admin.del.selfDelete')
        : msg.includes('last_admin') ? t('admin.del.lastAdmin')
        : t('admin.del.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Reads auth.users through the admin_list_users() RPC (migration 032). The old
  // query asked profiles for email/tier/role — none of which are columns on it — and
  // swallowed the resulting 400, which is why this page always showed "0 registered".
  useEffect(() => {
    let alive = true;
    listAdminUsers()
      .then(rows => { if (alive) setUsers(rows); })
      .catch(()  => { if (alive) setError(t('admin.usersLoadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  const filtered = query
    ? users.filter(u =>
        u.email.toLowerCase().includes(query.toLowerCase()) ||
        u.fullName.toLowerCase().includes(query.toLowerCase()) ||
        u.roles.toLowerCase().includes(query.toLowerCase()),
      )
    : users;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.allUsers')}</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{users.length} registered</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey" />
          <input
            type="text"
            placeholder={t('admin.searchUsers')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-brand-border-grey rounded-xl outline-none focus:ring-2 focus:ring-brand-near-black/20 bg-white w-56"
          />
        </div>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-state-complete/30 px-4 py-2.5 text-sm text-state-complete">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {error}
        </p>
      ) : (
        <div className="rounded-2xl border border-brand-border-grey overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border-grey bg-brand-off-white">
              <tr>
                {['Name', 'Email', 'Role', 'Plan', 'Projects', 'Joined', '', ''].map((h, i) => (
                  <th key={`${h}-${i}`} className="text-left px-4 py-3 text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">
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
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ROLE_STYLES[u.roles] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                      {u.roles || t('admin.roleClient')}
                    </span>
                  </td>
                  {/* "Plan" is the most recent project's tier, so it is blank for anyone
                      with no projects — which reads as a billing gap when it is really a
                      signup that never started anything. The count next to it says which. */}
                  <td className="px-4 py-3 text-brand-mid-grey">{u.tier ? labels.tier(u.tier) : '—'}</td>
                  <td className="px-4 py-3 text-brand-mid-grey tabular-nums">{u.projectCount}</td>
                  <td className="px-4 py-3 text-brand-mid-grey text-xs">
                    {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-brand-mid-grey">{u.id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button" onClick={() => setTarget(u)}
                      aria-label={`${t('admin.del.confirm')} ${u.email}`}
                      className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-brand-mid-grey">
                    No users match "{query}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDelete
        open={!!target}
        subject={target?.email ?? ''}
        consequence={target ? (target.projectCount > 0
          ? t('admin.del.userProjects', { count: target.projectCount })
          : t('admin.del.userNoProjects')) : undefined}
        busy={busy}
        error={delError}
        onConfirm={confirmDelete}
        onCancel={() => { setTarget(null); setDelError(null); }}
      />
    </div>
  );
}
