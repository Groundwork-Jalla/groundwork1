import { useId, useState } from 'react';
import {
  DIAL_COUNTRIES, countryOfE164, dialCountry, nationalPart, normalisePhone,
  type DialCountry,
} from '@/lib/phone';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { cn } from '@/lib/utils';

// =========================================================
// A phone number, with the country picked rather than guessed.
//
// Most people do not know their dialling code, and typing "+237" is not something a
// contractor should have to do to reach the next screen. Before this, every phone input
// assumed Cameroon: a number entered by a partner in Paris, or a next of kin in London,
// was silently prefixed +237 and became a number that reaches nobody.
//
// Cameroon is still the default — it is the market — but it is now a default, not an
// assumption, and the person can say otherwise.
//
// ── What it emits ───────────────────────────────────────────────────────────────────
// E.164, or '' when there is nothing usable yet. The caller never sees a national
// number, so nothing downstream has to know which country it came from.
// =========================================================

export function PhoneField({
  id, value, onChange, countries = DIAL_COUNTRIES, defaultCountry = DEFAULT_COUNTRY_CODE,
  required, disabled, placeholder, className,
}: {
  id?: string;
  /** E.164, or '' */
  value: string;
  onChange: (e164: string) => void;
  /** Narrow this where not every country is servable — payouts, for instance. */
  countries?: DialCountry[];
  defaultCountry?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;

  // Country and the national part are the component's own state, seeded once from the
  // incoming value. Deriving them on every render instead would fight the person as
  // they type — a half-typed number has no inferable country.
  const [country, setCountry] = useState(
    () => countryOfE164(value) ?? defaultCountry);
  const [national, setNational] = useState(
    () => nationalPart(value, countryOfE164(value) ?? defaultCountry));

  // A country the caller does not offer must not stay selected.
  const selected = countries.some(c => c.code === country)
    ? country
    : (countries[0]?.code ?? defaultCountry);

  const emit = (iso: string, local: string) => {
    const trimmed = local.trim();
    if (!trimmed) { onChange(''); return; }
    // normalisePhone returns its input unchanged when it cannot place the number, so
    // what goes up may not be E.164. The caller validates with isE164 — this field's
    // job is to make the common case right, not to be the last line of defence.
    onChange(normalisePhone(trimmed, iso) ?? '');
  };

  const dial = dialCountry(selected)?.dial;

  return (
    <div className={cn('flex gap-2', className)}>
      <div className="relative shrink-0">
        <select
          aria-label="Country"
          value={selected}
          disabled={disabled}
          onChange={e => { setCountry(e.target.value); emit(e.target.value, national); }}
          className="h-full appearance-none rounded-xl border border-brand-border-grey bg-white py-2 pl-3 pr-7 text-sm text-brand-near-black dark:border-[#444] dark:bg-[#141414] dark:text-white"
        >
          {countries.map(c => (
            // The flag and the dialling code, because the code is the thing being
            // chosen and seeing it is what tells somebody they picked right.
            <option key={c.code} value={c.code}>{c.flag} +{c.dial}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-brand-mid-grey" aria-hidden>▾</span>
      </div>

      <input
        id={fieldId}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        disabled={disabled}
        value={national}
        placeholder={placeholder ?? (dial === '237' ? '6 70 00 00 00' : undefined)}
        onChange={e => { setNational(e.target.value); emit(selected, e.target.value); }}
        className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black dark:border-[#444] dark:bg-[#141414] dark:text-white"
      />
    </div>
  );
}
