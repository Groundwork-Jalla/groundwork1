import { swychrConfig, type SwychrConfig } from './_config.js';

/**
 * SwyChr, transcribed from the published contract (SwychrConnect Payin + Payout, Sep 2026).
 *
 * ── Two services, one host ───────────────────────────────────────────────────────────
 *   /api/payin/…   collecting from a client   — Direct API, payment links, status
 *   /api/payout/…  paying a contractor        — create transaction, status, methods
 *
 * Each publishes its own `POST /admin/auth` taking email + password and returning a JWT.
 * The payin Direct API also accepts a long-lived `Api-Key`, which is what a server should
 * use: no login round trip and no token to expire mid-request. Payout publishes no
 * equivalent, so it logs in and the token is cached for the process.
 *
 * ── This is our reading of someone else's API ────────────────────────────────────────
 * Every shape below comes from documentation, not from a response we have seen. The same
 * was true of the GHL layer and it needed three attempts to get the media upload right.
 * So responses are read tolerantly, errors are returned verbatim rather than flattened to
 * a boolean, and nothing here assumes a field exists because the docs list it.
 *
 * ── It holds the money; we hold the record ───────────────────────────────────────────
 * Nothing in this file writes to the ledger. A caller takes what comes back and decides
 * what it means — `record_payment_event` (090) is the only thing that moves a payment's
 * state, and it is idempotent on (provider, provider_event_id) so a retry is free.
 */

export interface SwychrResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** The provider's own words. Kept whole: "why did this fail" is the expensive question. */
  error?: string;
}

const PATHS = {
  payinAuth:      '/api/payin/admin/auth',
  payinDirect:    '/api/payin/create_payment_request',
  payinLink:      '/api/payin/create_payment_links',
  payinStatus:    '/api/payin/payment_link_status',
  payoutAuth:     '/api/payout/admin/auth',
  payoutMethods:  '/api/payout/payout_methods',
  payoutCreate:   '/api/payout/create_transaction',
  payoutStatus:   '/api/payout/transaction_status',
} as const;

/** JWTs, per service, for the life of the process. Cleared on any 401. */
const tokens = new Map<'payin' | 'payout', { value: string; at: number }>();
const TOKEN_TTL_MS = 20 * 60_000;

export function invalidateSwychrTokens(): void { tokens.clear(); }

async function login(cfg: SwychrConfig, service: 'payin' | 'payout'): Promise<string | null> {
  const cached = tokens.get(service);
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.value;
  if (!cfg.email || !cfg.password) return null;

  const r = await request<{ token?: string }>(cfg, service === 'payin' ? PATHS.payinAuth : PATHS.payoutAuth, {
    method: 'POST',
    body: { email: cfg.email, password: cfg.password },
    auth: 'none',
  });
  const token = r.ok ? r.data?.token : undefined;
  if (!token) {
    console.error('[swychr] could not obtain a', service, 'token:', r.error ?? 'no token in response');
    return null;
  }
  tokens.set(service, { value: token, at: Date.now() });
  return token;
}

async function request<T>(
  cfg: SwychrConfig,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; auth: 'none' | 'apiKey' | 'payin' | 'payout'; headers?: Record<string, string> },
): Promise<SwychrResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };

  if (opts.auth === 'apiKey' && cfg.apiKey) {
    headers['Api-Key'] = cfg.apiKey;
  } else if (opts.auth === 'payin' || opts.auth === 'payout') {
    const token = await login(cfg, opts.auth);
    if (!token) return { ok: false, status: 0, error: 'no_credentials' };
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: opts.method ?? 'POST',
      headers,
      body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    });
  } catch (err) {
    // A network failure is not a payment failure. The caller must not read it as one.
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'network_error' };
  }

  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }

  if (!res.ok) {
    // A stale token is worth exactly one retry; anything else is the provider's answer.
    if (res.status === 401 && (opts.auth === 'payin' || opts.auth === 'payout')) tokens.delete(opts.auth);
    return { ok: false, status: res.status, error: text.slice(0, 500) };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// ── Payin: collecting from a client ───────────────────────────────────────────────────

export interface PayinRequest {
  countryCode: string;
  name: string;
  /** OURS, and unique across the SwyChr account — reusing one returns 400. */
  transactionId: string;
  amount: number;
  email?: string;
  mobile?: string;
  /** From `/payout_methods` for that country, e.g. MTN or ORANGE. */
  paymentMethod?: string;
  description?: string;
  /** True adds SwyChr's 2.5% digital charge on top, so the client pays it rather than us. */
  passDigitalCharge?: boolean;
  callbackUrl?: string;
  failedCallbackUrl?: string;
}

/**
 * Collect directly, with no hosted page.
 *
 * Mobile money is asynchronous: a 200 here means the request was accepted and the client
 * is being asked to confirm on their handset, NOT that money arrived. The webhook, or a
 * later status read, is what says it landed.
 */
export async function createPayinRequest(cfg: SwychrConfig, req: PayinRequest): Promise<SwychrResult<unknown>> {
  return request(cfg, PATHS.payinDirect, {
    auth: cfg.apiKey ? 'apiKey' : 'payin',
    body: {
      country_code: req.countryCode,
      name: req.name,
      transaction_id: req.transactionId,
      amount: req.amount,
      email: req.email,
      mobile: req.mobile,
      payment_method: req.paymentMethod,
      description: req.description,
      pass_digital_charge: req.passDigitalCharge,
      callback_url: req.callbackUrl ?? cfg.callbackUrl,
      failed_callback_url: req.failedCallbackUrl ?? cfg.callbackUrl,
      source: 'groundwork',
    },
  });
}

/** A hosted link to send a client instead of collecting in our own UI. */
export async function createPaymentLink(
  cfg: SwychrConfig,
  req: PayinRequest & { currency: string },
): Promise<SwychrResult<{ data?: { id?: string; payment_link?: string; transaction_id?: string } }>> {
  return request(cfg, PATHS.payinLink, {
    auth: cfg.apiKey ? 'apiKey' : 'payin',
    // The contract names an Idempotency-Key header to stop a retry creating a second link.
    // Ours is the transaction id, which is already unique per payment.
    headers: { 'Idempotency-Key': req.transactionId },
    body: {
      country_code: req.countryCode,
      name: req.name,
      email: req.email,
      mobile: req.mobile,
      amount: req.amount,
      currency: req.currency,
      transaction_id: req.transactionId,
      description: req.description,
      pass_digital_charge: req.passDigitalCharge,
      callback_url: req.callbackUrl ?? cfg.callbackUrl,
    },
  });
}

/** What SwyChr believes about a collection, by OUR transaction id. */
export async function payinStatus(cfg: SwychrConfig, transactionId: string): Promise<SwychrResult<unknown>> {
  return request(cfg, PATHS.payinStatus, {
    auth: cfg.apiKey ? 'apiKey' : 'payin',
    body: { transaction_id: transactionId },
  });
}

// ── Payout: paying a contractor ───────────────────────────────────────────────────────

export interface PayoutRequest {
  countryCode: string;
  beneficiaryName: string;
  mobileNo: string;
  amount: number;
  /** OURS, and unique across the account. */
  transactionId: string;
  paymentMethod: string;
  address?: string;
  remarks?: string;
  bankCode?: string;
  accountNumber?: string;
}

export async function createPayout(cfg: SwychrConfig, req: PayoutRequest): Promise<SwychrResult<{ transaction_id?: string }>> {
  return request(cfg, PATHS.payoutCreate, {
    auth: 'payout',
    body: {
      country_code: req.countryCode,
      beneficiary_name: req.beneficiaryName,
      mobile_no: req.mobileNo,
      address: req.address,
      amount: req.amount,
      transaction_id: req.transactionId,
      payment_method: req.paymentMethod,
      remarks: req.remarks,
      bank_code: req.bankCode,
      account_number: req.accountNumber,
    },
  });
}

export interface PayoutStatus {
  transaction_id?: string;
  status?: string;
  amount?: number | null;
  currency?: string;
  updated_at?: string;
  provider_reference?: string;
  failure_reason?: string;
}

/**
 * What SwyChr believes about a payout.
 *
 * This is the ONLY way to learn a payout's outcome: the published contract gives payins a
 * webhook and payouts none, so the outgoing leg has to be polled. See `_payout-poll.ts`.
 */
export async function payoutStatus(cfg: SwychrConfig, transactionId: string): Promise<SwychrResult<{ data?: PayoutStatus }>> {
  return request(cfg, PATHS.payoutStatus, { auth: 'payout', body: { transaction_id: transactionId } });
}

/** Which methods a country supports, and the mobile format each expects. */
export async function payoutMethods(cfg: SwychrConfig, countryCode: string): Promise<SwychrResult<unknown>> {
  return request(cfg, PATHS.payoutMethods, { auth: 'payout', body: { country_code: countryCode } });
}

/** Configuration plus a live credential check, for the Integrations page. */
export async function swychrReachable(): Promise<{ configured: boolean; authenticated: boolean | null; detail?: string }> {
  const cfg = await swychrConfig();
  if (!cfg) return { configured: false, authenticated: null };
  // An API key cannot be checked without spending a real call, so it is reported as
  // configured-but-untested rather than assumed good. Email/password can be proved.
  if (!cfg.email || !cfg.password) return { configured: true, authenticated: null };
  const token = await login(cfg, 'payin');
  return { configured: true, authenticated: !!token, detail: token ? undefined : 'login_refused' };
}
