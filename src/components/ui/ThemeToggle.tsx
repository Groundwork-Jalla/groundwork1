import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return document.documentElement.classList.contains('dark');
  });

  function toggle() {
    setDark(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  }

  return { dark, toggle };
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { dark, toggle } = useTheme();
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
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
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-off-white transition-colors"
    >
      {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
