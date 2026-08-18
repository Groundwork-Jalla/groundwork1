import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/lib/i18n';

// The state used to live in a `useTheme()` hook right here, one copy per toggle.
// It now comes from ThemeProvider so every toggle agrees and the choice is stored
// against the account — see contexts/ThemeContext.tsx.

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const t = useT();
  const dark = theme === 'dark';
  const label = dark ? t('theme.switchToLight') : t('theme.switchToDark');
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className="flex size-8 items-center justify-center rounded-lg text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
    >
      {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
      {dark ? t('theme.lightMode') : t('theme.darkMode')}
    </button>
  );
}
