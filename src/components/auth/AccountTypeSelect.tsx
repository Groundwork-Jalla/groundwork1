import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { SignupAccountType } from '@/lib/auth/signup-account';

// =========================================================
// "I am signing up as a …" — two buttons, each in its own colour.
//
// This used to be a pair of radio inputs with text labels, and on the 16 November
// onboarding review they were read as checkboxes: small, same-looking, easy to miss on
// a phone. The choice is the one thing the page needs answered before anything else,
// so it is now two large buttons that cannot be mistaken for each other:
//
//   Client     — brand green, the colour of every primary action a client takes
//   Contractor — ink (near-black), the colour of the contractor surface
//
// The selected one is filled; the other keeps its own colour as a 2px outline, so the
// two stay distinct whichever is active. Semantically it is still a radio group
// (`role="radiogroup"` / `role="radio"` + `aria-checked`), so screen readers and the
// existing tests see the same control as before.
//
// Presentational only: the parent still owns the value, which lives in `?role=` so a
// refresh, the back button and the embedded contractor form all keep reading it.
// =========================================================

const OPTIONS: readonly SignupAccountType[] = ['homeowner', 'contractor'] as const;

const SELECTED_STYLE = 'border-brand-green bg-brand-green text-white';
const UNSELECTED_STYLE =
  'border-brand-border-grey bg-white text-brand-near-black hover:border-brand-green hover:text-brand-green dark:border-[#2c2c2c] dark:bg-transparent dark:text-[#f0f0f0] dark:hover:border-[#4e9e78] dark:hover:text-[#86efac]';

export default function AccountTypeSelect({ value, onChange, disabled = false }: {
  value: SignupAccountType;
  onChange: (next: SignupAccountType) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="mt-8 space-y-2">
      <p id="accountType-label" className="text-sm font-medium">{t('auth.signup.accountType')}</p>
      <div role="radiogroup" aria-labelledby="accountType-label" className="grid grid-cols-2 gap-3">
        {OPTIONS.map(type => {
          const selected = value === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-account-type={type}
              onClick={() => { if (!selected) onChange(type); }}
              className={cn(
                'min-h-12 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green',
                'disabled:pointer-events-none disabled:opacity-50',
                selected ? SELECTED_STYLE : UNSELECTED_STYLE,
              )}
            >
              {t(type === 'contractor' ? 'auth.signup.contractor' : 'auth.signup.homeowner')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
