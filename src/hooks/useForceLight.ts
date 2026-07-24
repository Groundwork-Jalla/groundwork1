import { useEffect } from 'react';

export function useForceLight() {
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.remove('dark');
    return () => {
      if (wasDark || localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
      }
    };
  }, []);
}
