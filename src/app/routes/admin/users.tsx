import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { KeyRound, Loader2, Mail, Search, Trash2, UserPlus } from 'lucide-react';
import { listAdminUsers, deleteUser, type AdminUser } from '@/lib/supabase/admin-users';
import {
  filterAdminUsers,
  summarizeUserProjects,
  type JoinedFilter,
  type ProjectFilter,
  type RoleFilter,
} from '@/lib/admin/user-directory-filter';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { useDomainLabels } from '@/lib/domain-labels';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { CrmBackfillPanel } from '@/components/admin/CrmBackfillPanel';
import { PersonPreview, usePersonPreview } from '@/components/admin/PersonPreview';
import { UserRoleEditor } from '@/components/admin/UserRoleEditor';
import { AdminMessageUsersModal } from '@/components/admin/AdminMessageUsersModal';

const ROLE_STYLES: Record<string, string> = {
  admin:      'bg-brand-off-white text-state-active',
  contractor: 'bg-brand-off-white text-state-active',
  homeowner:  'bg-brand-off-white text-state-complete',
};

const VALID_PROJECT_FILTERS: readonly ProjectFilter[] = ['all', 'no_projects', 'has_projects'];
const VALID_ROLE_FILTERS: readonly RoleFilter[] = ['all', 'client', 'contractor', 'admin'];

export default function AdminUsers() {
  const t = useT();
  const labels = useDomainLabels();
  const [users, setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // `?q=` is how global search arrives here — the row it found is the row on screen.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const setQuery = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set('q', next); else p.delete('q');
    setParams(p, { replace: true });
    setSelectedIds(new Set());
  };

  const [projectFilter, setProjectFilterState] = useState<ProjectFilter>(() => {
    const raw = params.get('projects') as ProjectFilter | null;
    return raw && VALID_PROJECT_FILTERS.includes(raw) ? raw : 'all';
  });
  const [roleFilter, setRoleFilterState] = useState<RoleFilter>(() => {
    const raw = params.get('role') as RoleFilter | null;
    return raw && VALID_ROLE_FILTERS.includes(raw) ? raw : 'all';
  });
  const [joinedFilter, setJoinedFilterState] = useState<JoinedFilter>('all');

  // Changing any filter clears manual selections so hidden users from a previous
  // filter can never be accidentally included in a Message Users send.
  const setProjectFilter = (next: ProjectFilter) => {
    setProjectFilterState(next);
    setSelectedIds(new Set());
  };
  const setRoleFilter = (next: RoleFilter) => {
    setRoleFilterState(next);
    setSelectedIds(new Set());
  };
  const setJoinedFilter = (next: JoinedFilter) => {
    setJoinedFilterState(next);
    setSelectedIds(new Set());
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [messageOpen, setMessageOpen] = useState(false);

  const [target, setTarget]   = useState<AdminUser | null>(null);
  // Click a name, see what they signed up with — without leaving the list.
  const person = usePersonPreview();
  const [busy, setBusy]       = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const [typeTarget, setTypeTarget] = useState<AdminUser | null>(null);

  async function confirmDelete() {
    if (!target) return;
    setBusy(true); setDelError(null);
    try {
      const destroyed = await deleteUser(target.id);
      setUsers(prev => prev.filter(u => u.id !== target.id));
      setSelectedIds(prev => {
        if (!prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
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

  const summary = useMemo(() => summarizeUserProjects(users), [users]);
  const filtered = useMemo(
    () => filterAdminUsers(users, { query, projectFilter, roleFilter, joinedFilter }),
    [users, query, projectFilter, roleFilter, joinedFilter],
  );

  // Selection is strictly scoped to the currently visible filtered list so users
  // excluded by an active filter can never sneak into a broadcast.
  const visibleSelectedUsers = useMemo(
    () => filtered.filter(u => selectedIds.has(u.id)),
    [filtered, selectedIds],
  );
  const modalRecipients = visibleSelectedUsers.length > 0 ? visibleSelectedUsers : filtered;
  const allFilteredSelected = filtered.length > 0 && visibleSelectedUsers.length === filtered.length;
  const someFilteredSelected = visibleSelectedUsers.length > 0;

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const u of filtered) next.delete(u.id);
      } else {
        for (const u of filtered) next.add(u.id);
      }
      return next;
    });
  }

  function openMessageModal() {
    setMessageOpen(true);
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.allUsers')}</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            {summary.total} registered · {summary.withProjects} with projects · {summary.withoutProjects} without projects
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            onClick={openMessageModal}
            disabled={loading || modalRecipients.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-green bg-white px-3.5 py-2 text-sm font-semibold text-brand-green transition-colors hover:bg-brand-green hover:text-white disabled:opacity-40"
          >
            <Mail className="size-4" />
            {visibleSelectedUsers.length > 0
              ? `Message Selected (${visibleSelectedUsers.length})`
              : `Message Shown (${filtered.length})`}
          </button>
          <Link
            to="/admin/users/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-green/90"
          >
            <UserPlus className="size-4" /> {t('admin.provision.button')}
          </Link>
        </div>
      </div>

      {/* Filter & selection toolbar */}
      {!loading && !error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-border-grey bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-brand-border-grey bg-brand-off-white p-0.5 text-xs font-semibold">
              {([
                { id: 'all', label: `All (${summary.total})` },
                { id: 'no_projects', label: `No projects (${summary.withoutProjects})` },
                { id: 'has_projects', label: `Has projects (${summary.withProjects})` },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProjectFilter(tab.id)}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${
                    projectFilter === tab.id
                      ? 'bg-brand-green text-white shadow-xs'
                      : 'text-brand-mid-grey hover:text-brand-near-black'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value as RoleFilter)}
              className="rounded-xl border border-brand-border-grey bg-white px-3 py-1.5 text-xs font-semibold text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20"
            >
              <option value="all">All roles</option>
              <option value="client">Homeowners</option>
              <option value="contractor">Contractors</option>
              <option value="admin">Admins</option>
            </select>

            <select
              aria-label="Filter by join date"
              value={joinedFilter}
              onChange={e => setJoinedFilter(e.target.value as JoinedFilter)}
              className="rounded-xl border border-brand-border-grey bg-white px-3 py-1.5 text-xs font-semibold text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20"
            >
              <option value="all">Any join date</option>
              <option value="older_than_7d">Joined &gt; 7 days ago</option>
              <option value="last_7d">Joined last 7 days</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-brand-mid-grey">
              Showing <strong className="text-brand-near-black">{filtered.length}</strong>
              {visibleSelectedUsers.length > 0 && (
                <> · <strong className="text-brand-green">{visibleSelectedUsers.length} selected</strong></>
              )}
            </span>
            {filtered.length > 0 && (
              <button
                type="button"
                onClick={toggleAllFiltered}
                className="rounded-lg border border-brand-border-grey px-2.5 py-1 font-semibold text-brand-near-black hover:bg-brand-off-white"
              >
                {allFilteredSelected ? 'Deselect shown' : `Select shown (${filtered.length})`}
              </button>
            )}
            {visibleSelectedUsers.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg px-2 py-1 font-medium text-brand-mid-grey hover:text-brand-near-black"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {notice && (
        <p role="status" className="mb-4 mt-4 rounded-xl border border-state-complete/30 px-4 py-2.5 text-sm text-state-complete">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : error ? (
        <p role="alert" className="mt-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {error}
        </p>
      ) : (
        <div className="mt-4 rounded-2xl border border-brand-border-grey overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-border-grey bg-brand-off-white">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all visible users"
                    checked={allFilteredSelected}
                    ref={el => {
                      if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={toggleAllFiltered}
                    className="size-4 rounded border-brand-border-grey accent-brand-green"
                  />
                </th>
                {['Name', 'Email', 'Role', 'Plan', 'Projects', 'Joined', '', ''].map((h, i) => (
                  <th key={`${h}-${i}`} className="text-left px-4 py-3 text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(u => {
                const checked = selectedIds.has(u.id);
                return (
                  <tr
                    key={u.id}
                    className={`transition-colors hover:bg-brand-off-white ${checked ? 'bg-emerald-50/40' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${u.fullName || u.email}`}
                        checked={checked}
                        onChange={() => toggleOne(u.id)}
                        className="size-4 rounded border-brand-border-grey accent-brand-green"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-brand-near-black max-w-[200px]">
                      <button
                        type="button"
                        onClick={() => person.open({ userId: u.id, email: u.email }, u.roles)}
                        title={t('admin.person.view')}
                        className="block max-w-full truncate text-left underline-offset-2 hover:underline"
                      >
                        {u.fullName || u.email}
                      </button>
                      {/* Set up by an admin and not yet used: the temporary password is still
                          the only way in, so this is the account to chase, not to trust. */}
                      {u.mustChangePassword && (
                        <span
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-state-active"
                          title={t('admin.provision.awaitingHint')}
                        >
                          <KeyRound className="size-3" /> {t('admin.provision.awaiting')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-brand-mid-grey max-w-[200px] truncate">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ROLE_STYLES[u.roles] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                        {u.roles || t('admin.roleClient')}
                      </span>
                      <button type="button" onClick={() => setTypeTarget(u)} className="mt-1 block text-xs text-brand-green underline">
                        {t('admin.roleEdit.title')}
                      </button>
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
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-brand-mid-grey">
                    {query
                      ? `No users match "${query}" under the current filters.`
                      : 'No users match the selected filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <CrmBackfillPanel kind="users" />
      <PersonPreview reference={person.ref} rolesHint={person.rolesHint} onClose={person.close} />
      {typeTarget && <UserRoleEditor key={typeTarget.id} user={typeTarget} onClose={() => setTypeTarget(null)} onSaved={roles => {
        setUsers(previous => previous.map(row => row.id === typeTarget.id ? { ...row, roles } : row));
        setNotice(t('admin.roleEdit.done')); setTypeTarget(null);
      }} />}
      <AdminMessageUsersModal
        open={messageOpen}
        recipients={modalRecipients}
        onClose={() => setMessageOpen(false)}
        onSent={res => {
          setNotice(
            `Email sent to ${res.sent} user${res.sent === 1 ? '' : 's'}${res.failed > 0 ? ` (${res.failed} failed)` : ''}.`,
          );
        }}
      />
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
