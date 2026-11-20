/**
 * Strict CORS helper for Groundwork API routes.
 *
 * Web requests are same-origin (tryjalla.com -> tryjalla.com/api/*) and never need
 * permissive CORS headers. When wrapped as a native mobile app with Capacitor,
 * requests originate from `capacitor://localhost` (iOS) or `https://localhost`
 * (Android), so we allow ONLY those explicit native origins plus the configured
 * PUBLIC_SITE_URL origin.
 */

const NATIVE_CAPACITOR_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
]);

function configuredSiteOrigin(): string | null {
  const raw = process.env.PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function isAllowedCorsOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (NATIVE_CAPACITOR_ORIGINS.has(origin)) return true;
  const site = configuredSiteOrigin();
  if (site && origin === site) return true;
  return false;
}

/**
 * Applies CORS headers for trusted native/app origins and short-circuits OPTIONS
 * preflight requests with 204. Returns `true` when the request was handled as a
 * preflight and the caller should return immediately.
 */
export function handleCors(req: any, res: any): boolean {
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : undefined;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req?.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
