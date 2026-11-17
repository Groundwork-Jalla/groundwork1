import { useT } from '@/lib/i18n';

/**
 * The signup form's contact permission. Optional and unticked: a permission somebody
 * has to untick is not one they gave.
 */
export function ContactPermissionCheckbox({ checked, onChange, disabled = false }: {
  checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const t = useT();
  return (
    <label htmlFor="contact-permission" className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-border-grey px-3 py-3 text-sm">
      <input id="contact-permission" name="contact-permission" type="checkbox" checked={checked} disabled={disabled}
        onChange={event => onChange(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-green" />
      <span>
        <span className="block text-brand-near-black">{t('auth.contactPermission.label')}</span>
        <span className="mt-1 block text-xs text-brand-mid-grey">{t('auth.contactPermission.hint')}</span>
      </span>
    </label>
  );
}
