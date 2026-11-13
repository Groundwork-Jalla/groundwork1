import { useId, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ACCOUNT_ROLES, accountRoleOf, roleAssignmentMatches, type AccountRole } from '@/lib/auth/account-role';
import { setUserRole, type AdminUser } from '@/lib/supabase/admin-users';

export function UserRoleEditor({ user, onSaved, onClose }: {
  user: AdminUser; onSaved: (roles: string) => void; onClose: () => void;
}) {
  const t = useT(); const id = useId();
  const [selected, setSelected] = useState<AccountRole>(accountRoleOf(user.roles));
  const [busy, setBusy] = useState(false); const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = roleAssignmentMatches(user.roles, selected);
  async function save() {
    if (working.current || unchanged) return;
    working.current = true; setBusy(true); setError(null);
    try { onSaved(await setUserRole(user.id, selected, user.roles)); }
    catch (error) {
      const message = (error as { message?: string })?.message ?? '';
      setError(t(message.includes('last_admin') ? 'admin.roleEdit.lastAdmin'
        : message.includes('stale_account_role') ? 'admin.roleEdit.stale'
        : message.includes('not_admin') ? 'admin.roleEdit.notAdmin' : 'admin.roleEdit.failed'));
    } finally { working.current = false; setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-[#1e1e1e]">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-lg font-semibold">{t('admin.roleEdit.title')}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label={t('common.close')}><X className="size-4" aria-hidden /></button>
      </div>
      <p className="mt-2 break-all text-sm text-brand-mid-grey">{user.email}</p>
      <p className="mt-3 text-sm text-brand-mid-grey">{t('admin.roleEdit.hint')}</p>
      <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="block text-sm" htmlFor={`${id}-role`}>{t('admin.roleEdit.label')}</label>
        <select id={`${id}-role`} name="account-role" value={selected} disabled={busy} onChange={event => setSelected(event.target.value as AccountRole)}
          className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]">
          {ACCOUNT_ROLES.map(role => <option key={role} value={role}>{t(`adminRole.${role}`)}</option>)}
        </select>
        {selected === 'admin' && <p className="text-xs text-brand-mid-grey">{t('admin.roleEdit.adminAccess')}</p>}
        {error && <p role="alert" className="text-sm text-state-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">{t('common.cancel')}</button>
          <button type="submit" disabled={busy || unchanged} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('admin.roleEdit.save')}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
