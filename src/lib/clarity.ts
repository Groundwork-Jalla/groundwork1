import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const CLARITY_ID: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CLARITY_PROJECT_ID?.trim()) || '';

const EXCLUDED_PREFIXES = [
  '/auth',
  '/admin',
  '/invite',
  '/claim',
  '/reset-password',
  '/verify',
] as const;

/**
 * Auth screens, invite/claim token flows, and internal admin operations are never
 * recorded by session replay.
 */
export function isClarityAllowedPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return !EXCLUDED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** Coarse, non-PII surface tag for filtering heatmaps & recordings in Clarity. */
export function claritySurfaceForPath(pathname: string): 'contractor' | 'client' | 'tools' | 'public' {
  if (pathname.startsWith('/work')) return 'contractor';
  if (pathname.startsWith('/tools')) return 'tools';
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/documents') ||
    pathname.startsWith('/payments') ||
    pathname.startsWith('/messages') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/onboarding')
  ) {
    return 'client';
  }
  return 'public';
}

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

let clarityInjected = false;

function ensureClarityLoaded(projectId: string) {
  if (clarityInjected || !projectId || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  clarityInjected = true;
  if (!window.clarity) {
    const queue = (...args: unknown[]) => {
      ((queue as unknown as { q?: unknown[][] }).q = (queue as unknown as { q?: unknown[][] }).q || []).push(args);
    };
    window.clarity = queue;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
  script.dataset.clarityTag = 'true';
  document.head.appendChild(script);
}

/**
 * Privacy-first Microsoft Clarity loader.
 * - No-op when VITE_CLARITY_PROJECT_ID is unset.
 * - Never injects on /auth/*, /admin/*, /invite/*, /claim/*, or /verify*.
 * - If already loaded earlier in the session and the user navigates into an excluded
 *   route, applies root-level `data-clarity-mask="true"` so the entire DOM is masked.
 * - Financial amounts, receipts, personal profiles, documents, and live chat carry
 *   dedicated `data-clarity-mask="true"` attributes on every route.
 */
export function ClarityTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!CLARITY_ID || typeof document === 'undefined') return;
    const allowed = isClarityAllowedPath(location.pathname);

    if (!allowed) {
      document.documentElement.setAttribute('data-clarity-mask', 'true');
      return;
    }

    document.documentElement.removeAttribute('data-clarity-mask');
    ensureClarityLoaded(CLARITY_ID);
    try {
      window.clarity?.('set', 'surface', claritySurfaceForPath(location.pathname));
    } catch {
      // Never allow analytics to disturb product flows.
    }
  }, [location.pathname]);

  return null;
}
