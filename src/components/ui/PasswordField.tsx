import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * A password box you can look at.
 *
 * ── Why this is a component and not seven edits ─────────────────────────────────────
 * There are seven password inputs across login, signup, the role signup and the
 * set-a-new-password page. A toggle pasted into each would drift: one would keep the
 * icon when disabled, another would lose the accessible name, a third would forget that
 * the label changes with the state.
 *
 * ── It is a real button, and it says what it does ───────────────────────────────────
 * Reported as a usability problem on the invited-verifier flow, where somebody typing a
 * password from an email has no way to check it before submitting. The control is
 * keyboard reachable, its `aria-label` changes between show and hide, and it is skipped
 * by the tab order of password managers because it carries no form value.
 *
 * It never changes `autoComplete`: that is what tells a password manager whether this is
 * a new password or an existing one, and it must keep saying so while revealed.
 */
export function PasswordField({ className, ...props }: React.ComponentProps<'input'>) {
  const t = useT();
  const [shown, setShown] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        // Room for the button, so a long password never runs underneath it.
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        disabled={props.disabled}
        aria-label={t(shown ? 'auth.hidePassword' : 'auth.showPassword')}
        title={t(shown ? 'auth.hidePassword' : 'auth.showPassword')}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-brand-mid-grey transition-colors hover:text-brand-near-black disabled:opacity-50 dark:hover:text-white"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
