const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (!(window as any).gtag) return;
  (window as any).gtag('event', name, params);
}

export { GA_ID };
