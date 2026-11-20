import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTheme } from '@/contexts/ThemeContext';
import { installNativeApiBridge, isNativeApp, parseNativeDeepLink } from '@/lib/mobile/runtime';

/**
 * Native Capacitor lifecycle bridge.
 *
 * Completely inert on web browsers (`!isNativeApp()`). Inside the iOS/Android
 * Capacitor shell, it:
 * 1. Marks `<html class="native-app">` for safe-area and overscroll rules.
 * 2. Installs the `/api/*` origin bridge so all existing API calls reach production.
 * 3. Routes incoming Universal Links / App Links into React Router without reloads.
 * 4. Handles the Android hardware back button gracefully inside app history.
 * 5. Syncs the native StatusBar appearance with Groundwork's Light/Dark theme.
 * 6. Hides the native SplashScreen once the UI is mounted.
 */
export function NativeAppBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();

  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.classList.add('native-app');
    const teardownFetch = installNativeApiBridge();

    const plugins = window.Capacitor?.Plugins;
    void plugins?.SplashScreen?.hide?.().catch(() => {});

    type ListenerHandle = { remove: () => void | Promise<void> };
    const handles: ListenerHandle[] = [];
    const register = (maybeHandle: Promise<ListenerHandle> | ListenerHandle | undefined) => {
      if (!maybeHandle) return;
      if ('then' in maybeHandle && typeof maybeHandle.then === 'function') {
        void maybeHandle.then((h: ListenerHandle) => { if (h) handles.push(h); }).catch(() => {});
      } else if ('remove' in maybeHandle) {
        handles.push(maybeHandle);
      }
    };

    if (plugins?.App?.addListener) {
      register(
        plugins.App.addListener('appUrlOpen', event => {
          const url = typeof event?.url === 'string' ? event.url : '';
          const path = parseNativeDeepLink(url);
          if (path) navigate(path);
        }),
      );

      register(
        plugins.App.addListener('backButton', event => {
          const canGoBack = event?.canGoBack === true || window.history.length > 1;
          const isRootTab = ['/', '/dashboard', '/projects', '/work', '/work/projects'].includes(location.pathname);
          if (canGoBack && !isRootTab) {
            navigate(-1);
          } else {
            void plugins.App?.exitApp?.();
          }
        }),
      );
    }

    return () => {
      teardownFetch();
      document.documentElement.classList.remove('native-app');
      for (const h of handles) {
        try { void h.remove(); } catch { /* ignore */ }
      }
    };
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (!isNativeApp()) return;
    const statusBar = window.Capacitor?.Plugins?.StatusBar;
    if (!statusBar) return;
    const isDark = theme === 'dark';
    // Capacitor StatusBar: 'DARK' = light text on dark bg; 'LIGHT' = dark text on light bg.
    void statusBar.setStyle?.({ style: isDark ? 'DARK' : 'LIGHT' }).catch(() => {});
    void statusBar.setBackgroundColor?.({ color: isDark ? '#141414' : '#ffffff' }).catch(() => {});
  }, [theme]);

  return null;
}
