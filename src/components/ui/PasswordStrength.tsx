import { Check, X } from 'lucide-react';
import {
  evaluatePassword, type PasswordContext, type RuleId, type StrengthLabel,
} from '@/lib/auth/password-policy';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Password strength meter + the rule checklist, for every screen that sets a password.
//
// The checklist used to live inline in signup.tsx with its own copy of the rules, and
// /auth/new-password had neither — see the header of password-policy.ts for what that
// cost. This component owns the presentation; the policy owns the rules.
//
// THE METER AND THE CHECKLIST SAY DIFFERENT THINGS, on purpose. The checklist is what
// the form will accept. The meter is how good the password actually is. A password can
// be valid and still read "Weak" — that is the honest answer for `Abcdefghi1`, and a
// meter that showed a full bar the instant the last box ticked would be telling people
// the minimum is the target.
//
// Colour is reinforcement, never the message: the bar carries the reading in how many
// segments are filled, and the label says it in words. Per docs/SCREEN-DESIGNS.md, colour
// is a status accent — someone who cannot see the difference between amber and green
// still gets the whole meaning.
// =========================================================

const RULE_KEYS: Record<RuleId, TKey> = {
  length:      'auth.password.ruleLength',
  upper:       'auth.password.ruleUpper',
  lower:       'auth.password.ruleLower',
  number:      'auth.password.ruleNumber',
  notCommon:   'auth.password.ruleNotCommon',
  notPersonal: 'auth.password.ruleNotPersonal',
};

const LABEL_KEYS: Record<StrengthLabel, TKey> = {
  weak:   'auth.password.weak',
  fair:   'auth.password.fair',
  good:   'auth.password.good',
  strong: 'auth.password.strong',
};

/** Accent per level. Reinforces the segment count; never the only signal. */
const BAR_COLOR: Record<StrengthLabel, string> = {
  weak:   'bg-state-alert',
  fair:   'bg-state-held',
  good:   'bg-state-active',
  strong: 'bg-state-complete',
};

export function PasswordStrength({
  password, context, showRules = true,
}: {
  password: string;
  /** Email and name, so the meter can refuse a password made of them. */
  context?: PasswordContext;
  /** The meter alone, for a confirm field or a compact form. */
  showRules?: boolean;
}) {
  const t = useT();

  // Nothing typed yet is not "weak" — it is nothing. Rendering a red empty bar under an
  // untouched field reads as an error the person has not made.
  if (!password) return null;

  const { rules, score, label } = evaluatePassword(password, context);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div
          className="flex h-1 flex-1 gap-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={score}
          aria-label={t('auth.password.strengthLabel')}
        >
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-full flex-1 rounded-full transition-colors ${
                i < score ? BAR_COLOR[label] : 'bg-brand-border-grey dark:bg-[#2c2c2c]'
              }`}
            />
          ))}
        </div>
        <span className="w-16 shrink-0 text-right text-[11px] font-medium text-brand-mid-grey">
          {t(LABEL_KEYS[label])}
        </span>
      </div>

      {showRules && (
        <ul className="mt-2 space-y-1">
          {rules.map(rule => (
            <li
              key={rule.id}
              className={`flex items-center gap-1.5 text-xs ${
                rule.passed
                  ? 'text-brand-near-black dark:text-white'
                  : 'text-brand-mid-grey'
              }`}
            >
              {/* Icons stay black and white — the tick IS the state. */}
              {rule.passed ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
              {t(RULE_KEYS[rule.id])}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
