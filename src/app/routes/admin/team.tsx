import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { listAdminUsers, type AdminUser } from '@/lib/supabase/admin-users';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/team — who works here, and what they may do (01 §3 SYSTEM).
//
// ── Read-only, and deliberately ──────────────────────────────────────────────────────
// Roles live in `user_roles`, and the only audited path that changes one is provisioning
// (083) and a direct insert by someone with database access. There is no server-side
// grant/revoke with an audit trail, so this screen SHOWS who holds what and does not
// pretend to change it. A button that quietly writes a role table with no record of who
// did it is worse than no button.
//
// Staff only: a client or contractor is not a member of the team and is managed under
// Clients and Contractors. The distinction is the role itself, never a guess.
// =========================================================

type Role = 'admin' | 'verifier';
const ROLES: Role[] = ['admin', 'verifier'];

const rolesOf = (u: AdminUser) => u.roles.split(',').map(r => r.trim()).filter(Boolean);

export default function AdminTeam() {
  const t = useT();
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listAdminUsers()); setError(null); }
    catch (err) { setRows([]); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const staff = (rows ?? []).filter(u => rolesOf(u).some(r => ROLES.includes(r as Role)));
  const count = (role: Role) => staff.filter(u => rolesOf(u).includes(role)).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.team.title')}</h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.team.subtitle')}</p>
        </div>
        {rows !== null && (
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
            {ROLES.map(role => (
              <div key={role} className="flex items-baseline gap-1.5">
                <dt className="text-brand-muted-grey">{t(`admin.team.roles.${role}` as TKey)}</dt>
                <dd className="font-semibold tabular-nums text-brand-near-black dark:text-white">{count(role)}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{error}</p>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<ShieldCheck className="size-8" />} title={t('admin.team.empty')} description={t('admin.team.emptyBody')} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-brand-border-grey text-[11px] text-brand-muted-grey dark:border-[#2c2c2c]">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">{t('admin.team.person')}</th>
                  {ROLES.map(role => (
                    <th key={role} scope="col" className="px-3 py-2.5 text-center font-medium">{t(`admin.team.roles.${role}` as TKey)}</th>
                  ))}
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">{t('admin.team.lastSeen')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                {staff.map(u => {
                  const held = rolesOf(u);
                  return (
                    <tr key={u.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-brand-near-black dark:text-white">{u.fullName || u.email}</p>
                        {u.fullName && <p className="text-[11px] text-brand-mid-grey">{u.email}</p>}
                      </td>
                      {ROLES.map(role => (
                        <td key={role} className="px-3 py-3 text-center">
                          {held.includes(role)
                            ? <span className="inline-block size-1.5 rounded-full bg-brand-near-black align-middle dark:bg-white" aria-label={t(`admin.team.roles.${role}` as TKey)} />
                            : <span className="text-brand-border-grey" aria-hidden>—</span>}
                        </td>
                      ))}
                      <td className={cn('px-5 py-3 text-right tabular-nums', u.lastSignInAt ? 'text-brand-mid-grey' : 'text-brand-border-grey')}>
                        {u.lastSignInAt ? formatRelative(u.lastSignInAt) : t('admin.team.never')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Say why there is nothing to click, rather than leaving a screen that looks broken. */}
          <p className="text-[11px] text-brand-mid-grey">{t('admin.team.readOnly')}</p>
        </>
      )}
    </div>
  );
}
