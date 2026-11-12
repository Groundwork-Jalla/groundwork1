import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { accountType, setAccountType, type AdminUser, type AccountType } from '@/lib/supabase/admin-users';

export function AccountTypeEditor({ user, onSaved, onClose }: {
  user: AdminUser; onSaved: (roles: string) => void; onClose: () => void;
}) {
  const t = useT(); const original = accountType(user.roles);
  const [selected, setSelected] = useState<AccountType>(original);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (inFlight.current || selected === original) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { onSaved(await setAccountType(user.id, selected, original)); }
    catch (error) {
      const message = (error as { message?: string })?.message ?? '';
      setError(t(message.includes('contractor_assignments_exist') ? 'admin.accountTypeEdit.assignments'
        : message.includes('stale_account_type') ? 'admin.accountTypeEdit.stale' : 'admin.accountTypeEdit.failed'));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="account-type-title" className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-[#1e1e1e]">
      <div className="flex items-center justify-between gap-3">
        <h2 id="account-type-title" className="text-lg font-semibold">{t('admin.accountTypeEdit.title')}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label={t('common.close')}><X className="size-4" aria-hidden /></button>
      </div>
      <p className="mt-2 break-all text-sm text-brand-mid-grey">{user.email}</p>
      <p className="mt-3 text-sm text-brand-mid-grey">{t('admin.accountTypeEdit.hint')}</p>
      <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="block text-sm">{t('admin.accountTypeEdit.label')}
          <select name="account-type" value={selected} disabled={busy} onChange={event => setSelected(event.target.value as AccountType)} className="mt-2 w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]">
            <option value="client">{t('admin.accountTypeEdit.client')}</option>
            <option value="contractor">{t('admin.accountTypeEdit.contractor')}</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-state-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">{t('common.cancel')}</button>
          <button type="submit" disabled={busy || selected === original} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('admin.accountTypeEdit.save')}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
