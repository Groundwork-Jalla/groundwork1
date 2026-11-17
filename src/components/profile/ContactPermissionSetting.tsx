import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { fetchContactPermission, setContactPermission } from '@/lib/auth/contact-permission';

/** Where a person changes their answer, any time. Saved the moment it is changed. */
export function ContactPermissionSetting() {
  const t = useT();
  const { user } = useAuth();
  const [value, setValue] = useState<boolean | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'failed' | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    void fetchContactPermission(user.id).then(recorded => { if (alive) setValue(recorded); });
    return () => { alive = false; };
  }, [user?.id]);

  // Not installed, or not readable: show nothing rather than a control that cannot save.
  if (value === undefined) return null;

  async function change(allowed: boolean) {
    if (busy) return;
    setBusy(true); setStatus(null);
    try { setValue(await setContactPermission(allowed, 'profile')); setStatus('saved'); }
    catch { setStatus('failed'); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="contact-permission-setting" className="my-5 rounded-2xl border p-5">
      <h2 id="contact-permission-setting" className="font-semibold">{t('auth.contactPermission.settingTitle')}</h2>
      <label htmlFor="contact-permission-profile" className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
        <input id="contact-permission-profile" type="checkbox" checked={value === true} disabled={busy}
          onChange={event => void change(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-green" />
        <span>{t('auth.contactPermission.label')}</span>
      </label>
      {value === null && <p className="mt-2 text-xs text-brand-mid-grey">{t('auth.contactPermission.notAnswered')}</p>}
      {status && <p role={status === 'failed' ? 'alert' : 'status'} className={`mt-2 text-xs ${status === 'failed' ? 'text-state-alert' : 'text-brand-mid-grey'}`}>
        {t(status === 'failed' ? 'auth.contactPermission.failed' : 'auth.contactPermission.saved')}</p>}
    </section>
  );
}
