import { Languages } from 'lucide-react';
import { useLanguage, LANG_META } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface LanguageToggleProps {
  /** Icon-only square button, for dense top bars. */
  compact?: boolean;
  /** Two-letter EN | FR segmented switch, for marketing navs. */
  segmented?: boolean;
  /** Renders light-on-dark, for the dark marketing navs. */
  onDark?: boolean;
  className?: string;
}

export function LanguageToggle({
  compact = false,
  segmented = false,
  onDark = false,
  className,
}: LanguageToggleProps) {
  const { lang, setLang, toggle, t } = useLanguage();

  const other = lang === 'en' ? 'fr' : 'en';
  const title = t('lang.switchTo', { lang: LANG_META[other].label });

  // ── Segmented EN | FR — highest clarity, used on public pages ──
  if (segmented) {
    return (
      <div
        role="group"
        aria-label={t('lang.language')}
        className={cn(
          'inline-flex items-center rounded-lg border p-0.5 text-[11px] font-semibold',
          onDark ? 'border-white/20' : 'border-brand-border-grey dark:border-[#2c2c2c]',
          className,
        )}
      >
        {(['en', 'fr'] as const).map(code => {
          const active = lang === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              aria-pressed={active}
              lang={LANG_META[code].htmlLang}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                active
                  ? onDark
                    ? 'bg-white text-brand-near-black'
                    : 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
                  : onDark
                    ? 'text-white/60 hover:text-white'
                    : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              {LANG_META[code].short}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Compact icon button — for app top bars ──
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className={cn(
          'flex size-8 items-center justify-center gap-1 rounded-lg transition-colors',
          // The compact variant used to ignore `onDark`, so on the public navbar it
          // rendered mid-grey on near-black and was effectively invisible.
          onDark
            ? 'text-white/70 hover:bg-white/10 hover:text-white'
            : 'text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#2c2c2c] dark:hover:text-white',
          className,
        )}
      >
        <span className="text-[10px] font-bold tabular-nums">{LANG_META[lang].short}</span>
      </button>
    );
  }

  // ── Full-width row — for the sidebar footer, matches ThemeToggle ──
  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors dark:hover:text-white dark:hover:bg-[#2c2c2c]',
        className,
      )}
    >
      <Languages className="size-4 shrink-0" />
      <span className="flex-1 text-left">{t('lang.language')}</span>
      <span className="text-[11px] font-bold text-brand-near-black dark:text-white">
        {LANG_META[lang].short}
      </span>
    </button>
  );
}

export default LanguageToggle;
