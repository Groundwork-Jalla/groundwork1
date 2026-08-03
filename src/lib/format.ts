/**
 * Money, number and date formatting.
 *
 * Two rules drive this module.
 *
 * 1. Foundations v1: "Cents are always shown. A figure that drops them looks estimated,
 *    and nothing on a money screen is estimated." So no $42K, no $1.23M — those read as
 *    guesses, and a build budget is not a guess.
 *
 * 2. Locale. Formatting used to be hardcoded to 'en-US' in 18 places, so a French user
 *    who toggled the language still saw "3 Aug 2026" and "1,234,567" instead of
 *    "3 août 2026" and "1 234 567". The toggle changed the words and left the numbers.
 *
 * Components should prefer the `useFormat()` hook from '@/lib/i18n', which re-renders on
 * a language change. The bare functions here exist for non-component callers (the PDF
 * export, for one) and read a module-level locale that LanguageProvider keeps in step.
 */

export type FormatLocale = 'en-US' | 'fr-FR';

const LOCALE_BY_LANG: Record<string, FormatLocale> = {
  en: 'en-US',
  fr: 'fr-FR',
};

let currentLocale: FormatLocale = 'en-US';

/** Kept in step by LanguageProvider. Only affects the bare functions below. */
export function setFormatLocale(lang: string): void {
  currentLocale = LOCALE_BY_LANG[lang] ?? 'en-US';
}

export function getFormatLocale(): FormatLocale {
  return currentLocale;
}

export function localeFor(lang: string): FormatLocale {
  return LOCALE_BY_LANG[lang] ?? 'en-US';
}

// ── Money ──────────────────────────────────────────────────

/**
 * A money figure, cents always shown.
 *
 * XAF and XOF are zero-decimal currencies — there is no centime in circulation, so
 * Intl renders them without decimals and we let it. The "always show cents" rule is
 * about not rounding a figure away, not about inventing a fractional unit.
 */
export function formatMoney(
  amount: number,
  currency = 'USD',
  locale: FormatLocale = currentLocale,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${formatNumber(amount, locale)}`;
  }
}

export function formatNumber(
  value: number,
  locale: FormatLocale = currentLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Percentages are figures too — mono, tabular, and locale-aware on the decimal mark. */
export function formatPercent(
  value: number,
  locale: FormatLocale = currentLocale,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

// ── Dates ──────────────────────────────────────────────────

const DATE_STYLES = {
  /** 3 Aug 2026 · 3 août 2026 */
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  /** 3 August 2026 · 3 août 2026 */
  long:   { day: 'numeric', month: 'long',  year: 'numeric' },
  /** 03/08/2026 */
  short:  { day: '2-digit', month: '2-digit', year: 'numeric' },
  /** Aug · août */
  month:  { month: 'short' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof DATE_STYLES;

export function formatDate(
  value: string | number | Date | null | undefined,
  style: DateStyle = 'medium',
  locale: FormatLocale = currentLocale,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, DATE_STYLES[style]).format(d);
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: FormatLocale = currentLocale,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(d);
}

/** "2 hours ago" / "il y a 2 heures" — for notification and activity feeds. */
export function formatRelative(
  value: string | number | Date | null | undefined,
  locale: FormatLocale = currentLocale,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const seconds = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['day', 86_400],
    ['hour', 3_600], ['minute', 60],
  ];
  for (const [unit, secondsIn] of units) {
    if (Math.abs(seconds) >= secondsIn) {
      return rtf.format(Math.round(seconds / secondsIn), unit);
    }
  }
  return rtf.format(Math.round(seconds), 'second');
}
