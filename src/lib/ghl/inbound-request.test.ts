import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADER_VALUE_MAX, REQUEST_META_MAX_BYTES, keepHeader, requestMeta } from '../../../api/ghl/_inbound-request';

/**
 * Phase 6.2, Option 2 (06 §16.7) — the sanitised request stored beside the payload.
 * The eleven things 094 must prove, as stated at the gate (18 Sep 2026).
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const HANDLER = 'api/_handlers/inbound.ts';

/** A request as Vercel hands it over — Node lower-cases header names. Values are placeholders. */
const vercelRequest = (extra: Record<string, string> = {}) => ({
  method: 'POST',
  query: { action: 'crm-inbound' },
  headers: {
    'host': 'tryjalla.com',
    'content-type': 'application/json',
    'content-length': '812',
    'user-agent': 'axios/1.x',
    'accept': 'application/json, text/plain, */*',
    'x-groundwork-secret': 'placeholder-secret-value',
    'x-forwarded-for': '203.0.113.10',
    'x-real-ip': '203.0.113.10',
    'forwarded': 'for=203.0.113.10',
    'cf-connecting-ip': '203.0.113.10',
    'true-client-ip': '203.0.113.10',
    'x-vercel-id': 'iad1::abcd-1700000000000-0123456789ab',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'tryjalla.com',
    // What the first real capture (18 Sep 2026) showed Vercel actually adds. Placeholder values.
    'x-invocation-id': 'sfo1::placeholder',
    'x-vercel-forwarded-for': '198.51.100.7',
    'x-vercel-proxied-for': '198.51.100.7',
    'x-vercel-ip-city': 'Placeholder%20City',
    'x-vercel-ip-latitude': '0.0000',
    'x-vercel-ip-longitude': '0.0000',
    'x-vercel-ja4-digest': 'placeholder_fingerprint',
    'x-vercel-proxy-signature': 'Bearer placeholder',
    'x-vercel-proxy-signature-ts': '0',
    'x-vercel-deployment-url': 'placeholder.vercel.app',
    ...extra,
  },
});

describe('3–6: what can never enter request.headers', () => {
  it('3. the shared secret, by name, whatever else is present', () => {
    const m = requestMeta(vercelRequest())!;
    expect(m.headers).not.toHaveProperty('x-groundwork-secret');
    expect(JSON.stringify(m)).not.toContain('placeholder-secret-value');
    expect(keepHeader('X-Groundwork-Secret')).toBe(false);
  });
  it('4. authorization and cookie', () => {
    const m = requestMeta(vercelRequest({ authorization: 'Bearer abc', cookie: 'sid=1' }))!;
    expect(m.headers).not.toHaveProperty('authorization');
    expect(m.headers).not.toHaveProperty('cookie');
  });
  it('5. anything whose name contains secret, token or key', () => {
    for (const n of ['x-api-key', 'x-ghl-token', 'my-secret-header', 'X-Access-Token', 'idempotency-key', 'apikey']) {
      expect(keepHeader(n), n).toBe(false);
    }
    const m = requestMeta(vercelRequest({ 'x-api-key': 'k', 'x-webhook-token': 't' }))!;
    expect(Object.keys(m.headers).some(k => /secret|token|key/.test(k))).toBe(false);
  });
  it('6. the client-IP headers the edge adds, plus user-agent and content-type', () => {
    const m = requestMeta(vercelRequest())!;
    for (const n of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'user-agent', 'content-type']) {
      expect(m.headers, n).not.toHaveProperty(n);
    }
    expect(JSON.stringify(m)).not.toContain('203.0.113.10');
  });
  it("6b. Vercel's own spellings — every x-vercel-* (IP, geo, fingerprint, proxy signature), x-invocation-id, x-forwarded-*", () => {
    const m = requestMeta(vercelRequest())!;
    expect(Object.keys(m.headers).filter(k => k.startsWith('x-vercel-') || k.startsWith('x-forwarded-') || k === 'x-invocation-id')).toEqual([]);
    const j = JSON.stringify(m);
    for (const leak of ['198.51.100.7', 'Placeholder%20City', 'placeholder_fingerprint', 'Bearer placeholder', 'sfo1::placeholder']) expect(j).not.toContain(leak);
    // What survives of a real Vercel request is only the generic client headers.
    expect(Object.keys(m.headers).sort()).toEqual(['accept', 'content-length', 'host']);
  });
  it('keeps what could establish identity — an unknown vendor header survives; a signature does not (it is a credential)', () => {
    const m = requestMeta(vercelRequest({ 'x-ghl-request-id': 'req_placeholder', 'x-wh-signature': 'sig_placeholder' }))!;
    expect(m.headers['x-ghl-request-id']).toBe('req_placeholder');
    expect(m.headers).not.toHaveProperty('x-wh-signature');
    expect(JSON.stringify(m)).not.toContain('sig_placeholder');
    expect(m.method).toBe('POST');
    expect(m.query).toEqual({ action: 'crm-inbound' });
  });
  it('7b. request.auth records the method only — secret | signature | null — and never a value', () => {
    expect(requestMeta(vercelRequest(), 'secret')!.auth).toBe('secret');
    expect(requestMeta(vercelRequest(), 'signature')!.auth).toBe('signature');
    expect(requestMeta(vercelRequest())!.auth).toBeNull();
    expect(Object.keys(requestMeta(vercelRequest(), 'secret')!).sort()).toEqual(['auth', 'headers', 'method', 'query']);
  });
  it('the same names are secrets in the query string too', () => {
    const m = requestMeta({ method: 'POST', query: { action: 'crm-inbound', token: 'x', secret: 'y' }, headers: {} })!;
    expect(m.query).toEqual({ action: 'crm-inbound' });
  });
});

describe('7–8: caps', () => {
  it('7. a header value is cut at 512 characters', () => {
    const m = requestMeta(vercelRequest({ 'x-long': 'a'.repeat(5000) }))!;
    expect(m.headers['x-long']).toHaveLength(HEADER_VALUE_MAX);
    expect(HEADER_VALUE_MAX).toBe(512);
  });
  it('8. the whole object is cut at 8 KB, longest values first, without throwing', () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 40; i++) extra[`x-h${i}`] = 'v'.repeat(500);
    const m = requestMeta(vercelRequest(extra))!;
    expect(JSON.stringify(m).length).toBeLessThanOrEqual(REQUEST_META_MAX_BYTES);
    expect(REQUEST_META_MAX_BYTES).toBe(8192);
    expect(m.method).toBe('POST');
  });
  it('odd input never throws; nothing to keep → null', () => {
    expect(requestMeta({})).toBeNull();
    expect(requestMeta({ headers: null, query: 'x', method: 7 })).toBeNull();
    expect(requestMeta({ headers: { accept: ['a', 'b'] } })!.headers.accept).toBe('a, b');
  });
});

describe('the handler and the migration', () => {
  const h = code(HANDLER);
  const at = (s: string) => { const i = h.indexOf(s); expect(i, `missing: ${s}`).toBeGreaterThan(-1); return i; };

  it('1. payload is still the body, unchanged, and 2. request is a separate nullable column', () => {
    expect(h).toContain('payload: body');
    expect(h).toContain('request: requestMeta(req, auth)');
    expect(h).not.toMatch(/payload:\s*\{/);                       // never wrapped or merged
    const m = src('supabase/migrations/094_inbound_event_request.sql');
    expect(m).toMatch(/ADD COLUMN IF NOT EXISTS request JSONB;/);
    expect(m).not.toMatch(/NOT NULL|DEFAULT/);                      // nullable, no default
    expect(m).not.toMatch(/ALTER COLUMN\s+payload|DROP COLUMN/);
  });

  it('3 again, at the boundary: credentials are checked, then the request is sanitised by requestMeta and nothing else touches headers', () => {
    expect(at("header(req, 'x-groundwork-secret')")).toBeLessThan(at('requestMeta(req, auth)'));
    // The handler reads headers through one accessor (credentials) and stores through the sanitiser only.
    expect((h.match(/req\.headers/g) ?? []).length).toBe(1);
    expect(h).not.toMatch(/request:\s*\{/);                       // never a hand-built request object
  });

  it('9. the write happens before the GHL_INBOUND_ACT gate, and 10–11. nothing else changed: capture-only, no new conversation/message write', () => {
    expect(at('request: requestMeta(req, auth)')).toBeLessThan(at("GHL_INBOUND_ACT.value === 'on'"));
    // A missing column (094 not yet applied) falls back to the pre-094 insert — capture never fails on evidence.
    expect(h).toContain("inserted.error?.code === 'PGRST204'");
    const beforeGate = h.slice(0, at("GHL_INBOUND_ACT.value === 'on'"));
    expect(beforeGate).not.toMatch(/project_messages|ensure_inbound_conversation|from\('conversations'\)/);
    expect((h.match(/from\('project_messages'\)/g) ?? []).length).toBe(1);   // still the one 6.2 upsert
  });

  it('the migration is 094, additive, and does not depend on 093', () => {
    const m = src('supabase/migrations/094_inbound_event_request.sql');
    expect(m).toMatch(/^-- =+\n-- 094 /);
    const ddl = m.replace(/^--.*$/gm, '');                          // statements only, not the prose
    expect(ddl).not.toMatch(/application_edit|contractor_applications/);
    expect(ddl).not.toMatch(/DROP|DELETE|UPDATE /);
    expect(ddl.trim()).toMatch(/^ALTER TABLE public\.ghl_inbound_events/);
  });
});
