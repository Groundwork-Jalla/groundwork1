/**
 * Capacitor native mobile runtime helpers.
 *
 * Design rule: On standard web browsers, every helper here is a zero-overhead
 * pass-through so web behavior stays 100% identical. Inside a native Capacitor
 * iOS/Android shell, these helpers bridge `/api/*` calls, Universal Links, and
 * auth callbacks to the live Groundwork origin.
 */

import { CANONICAL_SITE_URL } from '@/lib/site-url';

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    App?: {
      addListener?: (
        eventName: string,
        listener: (event: Record<string, unknown>) => void,
      ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
      exitApp?: () => Promise<void>;
    };
    StatusBar?: {
      setStyle?: (options: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>;
      setBackgroundColor?: (options: { color: string }) => Promise<void>;
    };
    SplashScreen?: {
      hide?: () => Promise<void>;
    };
  };
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

const DEFAULT_PUBLIC_ORIGIN = CANONICAL_SITE_URL;
const NATIVE_PROTOCOLS = new Set(['capacitor:', 'ionic:']);
const CUSTOM_URL_SCHEMES = new Set(['com.tryjalla.groundwork:', 'groundwork:']);

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function envValue(key: 'VITE_API_ORIGIN' | 'VITE_PUBLIC_APP_ORIGIN'): string {
  if (typeof import.meta === 'undefined') return '';
  const raw = (import.meta.env as Record<string, string | undefined> | undefined)?.[key];
  return typeof raw === 'string' ? trimTrailingSlash(raw.trim()) : '';
}

/** True only when running inside a native iOS/Android Capacitor shell. */
export function isNativeApp(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): boolean {
  if (!win) return false;
  try {
    if (win.Capacitor?.isNativePlatform?.() === true) return true;
    if (win.location && NATIVE_PROTOCOLS.has(win.location.protocol)) return true;
  } catch {
    return false;
  }
  return false;
}

export function nativePlatform(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): 'ios' | 'android' | 'web' {
  if (!isNativeApp(win)) return 'web';
  const platform = win?.Capacitor?.getPlatform?.();
  if (platform === 'ios' || platform === 'android') return platform;
  return 'web';
}

/**
 * Base origin for `/api/*` requests.
 * - On web: empty string (relative same-origin `/api/*` stays untouched).
 * - On native Capacitor: `VITE_API_ORIGIN`, falling back to `https://tryjalla.com`.
 */
export function apiOrigin(
  native: boolean = isNativeApp(),
  configured: string = envValue('VITE_API_ORIGIN') || envValue('VITE_PUBLIC_APP_ORIGIN'),
): string {
  if (!native) return '';
  return configured || DEFAULT_PUBLIC_ORIGIN;
}

/**
 * Best-practice URL builder for Groundwork API routes.
 * On web, `apiUrl('/api/events?action=live-chat')` returns `'/api/events?action=live-chat'`.
 * On native Capacitor, it returns `'https://tryjalla.com/api/events?action=live-chat'`.
 */
export function apiUrl(
  path: string,
  native: boolean = isNativeApp(),
  configured?: string,
): string {
  if (!path.startsWith('/')) return path;
  const origin = apiOrigin(native, configured);
  return origin ? `${origin}${path}` : path;
}

/**
 * Public HTTPS origin for auth callbacks (email confirmation, Google OAuth, password reset).
 * Native shells must never pass `capacitor://localhost` into emails or OAuth redirects;
 * they use the HTTPS Universal Link / App Link origin so links hand back into the app.
 */
export function authCallbackOrigin(
  currentOrigin: string = typeof window !== 'undefined' ? window.location.origin : DEFAULT_PUBLIC_ORIGIN,
  native: boolean = isNativeApp(),
  configured: string = envValue('VITE_PUBLIC_APP_ORIGIN') || envValue('VITE_API_ORIGIN'),
): string {
  if (!native && !currentOrigin.startsWith('capacitor://') && !currentOrigin.startsWith('ionic://')) {
    return trimTrailingSlash(currentOrigin);
  }
  return configured || DEFAULT_PUBLIC_ORIGIN;
}

const DEFAULT_ALLOWED_HOSTS = new Set(['tryjalla.com', 'www.tryjalla.com']);

/**
 * Converts an incoming Universal Link, App Link, or custom-scheme deep link into
 * a safe internal React Router path (pathname + search + hash), or null if rejected.
 */
export function parseNativeDeepLink(
  rawUrl: string,
  extraAllowedHosts: string[] = [],
): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  let internalPath: string | null = null;
  if (CUSTOM_URL_SCHEMES.has(parsed.protocol)) {
    // e.g. com.tryjalla.groundwork://invite/abc -> /invite/abc
    const hostPart = parsed.host ? `/${parsed.host}` : '';
    const pathPart = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    internalPath = `${hostPart}${pathPart || (hostPart ? '' : '/')}${parsed.search}${parsed.hash}`;
  } else if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    const allowed = new Set([...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts.map(h => h.toLowerCase())]);
    const configured = envValue('VITE_PUBLIC_APP_ORIGIN') || envValue('VITE_API_ORIGIN');
    if (configured) {
      try { allowed.add(new URL(configured).host.toLowerCase()); } catch { /* ignore */ }
    }
    if (!allowed.has(parsed.host.toLowerCase())) return null;
    internalPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  if (!internalPath || !internalPath.startsWith('/') || internalPath.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(internalPath)) {
    return null;
  }
  return internalPath;
}

let bridgeInstalled = false;

/**
 * Transparently rewrites relative `/api/*` fetches to `${apiOrigin()}/api/*`
 * ONLY when running inside a native Capacitor app. Total no-op on web.
 */
export function installNativeApiBridge(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): () => void {
  if (!win || !isNativeApp(win) || bridgeInstalled || typeof win.fetch !== 'function') {
    return () => {};
  }
  const originalFetch = win.fetch.bind(win);
  bridgeInstalled = true;

  win.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(apiUrl(input, true), init);
    }
    if (input instanceof URL && input.pathname.startsWith('/api/') && input.origin === win.location.origin) {
      return originalFetch(apiUrl(`${input.pathname}${input.search}`, true), init);
    }
    return originalFetch(input, init);
  };

  return () => {
    win.fetch = originalFetch;
    bridgeInstalled = false;
  };
}
