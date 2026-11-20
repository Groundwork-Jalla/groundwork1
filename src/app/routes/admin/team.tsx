import { UserRoleEditor } from '@/components/admin/UserRoleEditor';
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { supabase } from '@/lib/supabase/client';
import { STAFF_ROLES, type StaffRole } from '@/lib/admin/rbac';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type TableRole = StaffRole | 'verifier';
const ROLES: TableRole[] = ['admin', 'ops', 'finance', 'growth', 'verifier'];
const TOGGLEABLE_STAFF_ROLES: StaffRole[] = ['ops', 'finance', 'growth'];

const ROLE_PILL: Record<StaffRole, string> = {
  admin:   'bg-brand-green/10 text-brand-green dark:text-[#b4d8bf]',
  ops:     'bg-[#eaf2f8] text-[#26547c] dark:bg-[#1e3142] dark:text-[#93c5fd]',
  finance: 'bg-state-held/15 text-state-held',
  growth:  'bg-brand-light-grey text-brand-mid-grey dark:bg-[#2a2a2a]',
};

const rolesOf = (u: AdminUser) => u.roles.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

export default function AdminTeam() {
  const t = useT();
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listAdminUsers()); setError(null); }
    catch (err) { setRows([]); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const staff = (rows ?? []).filter(u => rolesOf(u).some(r => ROLES.includes(r as TableRole)));
  const count = (role: TableRole) => staff.filter(u => rolesOf(u).includes(role)).length;

  async function toggleStaffRole(user: AdminUser, role: StaffRole) {
    const key = `${user.id}:${role}`;
    if (toggling) return;
    const held = rolesOf(user);
    const nextGrant = !held.includes(role);
    setToggling(key);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('set_staff_role', {
        p_user: user.id,
        p_role: role,
        p_grant: nextGrant,
      });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err) {
      setError(errorMessage(err, t('admin.roleEdit.failed')));
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white">{t('admin.team.title')}</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.team.subtitle')}</p>
        </div>
      </header>

      {/* 4-Card Staff RBAC Role Matrix */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAFF_ROLES.map(role => (
          <div key={role} className="rounded-2xl border border-brand-border-grey bg-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <div className="flex items-center justify-between gap-2">
              <span className={cn('rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide', ROLE_PILL[role])}>
                {role}
              </span>
              <span className="font-mono text-xs text-brand-mid-grey">{t('admin.team.staffCount', { n: count(role) })}</span>
            </div>
            <p className="mt-2 text-sm font-bold text-brand-near-black dark:text-white">{t(`admin.team.roles.${role}` as TKey)}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">{t(`admin.team.roleDesc.${role}` as TKey)}</p>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-2xl border border-state-alert/30 bg-white px-5 py-3.5 text-xs text-state-alert dark:bg-[#1e1e1e]">{error}</p>
      )}

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<ShieldCheck className="size-8" />} title={t('admin.team.empty')} description={t('admin.team.emptyBody')} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-brand-border-grey text-[11px] uppercase tracking-wider text-brand-muted-grey dark:border-[#2c2c2c]">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">{t('admin.team.person')}</th>
                  {ROLES.map(role => (
                    <th key={role} scope="col" className="px-3 py-3 text-center font-semibold">{t(`admin.team.roles.${role}` as TKey)}</th>
                  ))}
                  <th scope="col" className="px-5 py-3 text-right font-semibold">{t('admin.team.lastSeen')}</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">{t('admin.roleEdit.label')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                {staff.map(u => {
                  const held = rolesOf(u);
                  return (
                    <tr key={u.id} className="hover:bg-brand-off-white/60 dark:hover:bg-[#242424]">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-brand-near-black dark:text-white">{u.fullName || u.email}</p>
                        {u.fullName && <p className="text-[11px] text-brand-mid-grey">{u.email}</p>}
                      </td>
                      {ROLES.map(role => {
                        const has = held.includes(role);
                        const canToggle = (TOGGLEABLE_STAFF_ROLES as string[]).includes(role);
                        const busy = toggling === `${u.id}:${role}`;
                        return (
                          <td key={role} className="px-3 py-3 text-center">
                            {canToggle ? (
                              <button
                                type="button"
                                disabled={toggling !== null}
                                onClick={() => void toggleStaffRole(u, role as StaffRole)}
                                aria-pressed={has}
                                aria-label={`${u.fullName || u.email} · ${t(`admin.team.roles.${role}` as TKey)}`}
                                className={cn(
                                  'mx-auto inline-flex size-6 items-center justify-center rounded-md border transition-colors disabled:opacity-40',
                                  has
                                    ? 'border-brand-green bg-brand-green text-white'
                                    : 'border-brand-border-grey bg-white text-transparent hover:border-brand-near-black dark:border-[#3a3a3a] dark:bg-transparent',
                                )}
                              >
                                {busy ? <Loader2 className="size-3 animate-spin text-brand-mid-grey" /> : <Check className="size-3.5 stroke-[3]" />}
                              </button>
                            ) : has ? (
                              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-green text-white" aria-label={t(`admin.team.roles.${role}` as TKey)}>
                                <Check className="size-3 stroke-[3]" />
                              </span>
                            ) : (
                              <span className="text-brand-border-grey" aria-hidden>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={cn('px-5 py-3 text-right tabular-nums', u.lastSignInAt ? 'text-brand-mid-grey' : 'text-brand-border-grey')}>
                        {u.lastSignInAt ? formatRelative(u.lastSignInAt) : t('admin.team.never')}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button type="button" onClick={() => setRoleTarget(u)} className="text-xs font-semibold text-brand-green underline underline-offset-4">
                          {t('admin.roleEdit.title')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-brand-mid-grey">{t('admin.roleEdit.hint')}</p>
        </>
      )}
      {roleTarget && <UserRoleEditor key={roleTarget.id} user={roleTarget} onClose={() => setRoleTarget(null)} onSaved={roles => {
        setRows(previous => previous?.map(row => row.id === roleTarget.id ? { ...row, roles } : row) ?? null); setRoleTarget(null);
      }} />}
    </div>
  );
}
