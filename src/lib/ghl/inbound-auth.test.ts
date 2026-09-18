import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authenticateInbound, secretMatches, signatureMatches } from '../../../api/ghl/_inbound-auth';
import { parseBody } from '../../../api/_lib/body';

/**
 * Phase 6.2 A.0 (06 §16.10) — the second door, and the raw bytes it needs.
 *
 * The key pair below is GENERATED HERE, per run. It stands in for GHL's: same algorithm,
 * same encoding, no relation to their keys. GHL's private key exists only at GHL; their
 * public key is configuration a person pastes from their docs — neither is in this repo.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const sign = (raw: Buffer, key = privateKey) => createSign('SHA256').update(raw).end().sign(key, 'base64');

/** A Marketplace-style body, placeholder values, with the whitespace GHL happens to send. */
const RAW = Buffer.from('{"type":"InboundMessage","locationId":"loc_placeholder","contactId":"ct_placeholder","messageId":"msg_placeholder","body":"hello"}');

describe('1. raw bytes are what verification sees', () => {
  it('the signature is over the bytes as received — re-serialising the same JSON breaks it', () => {
    const sig = sign(RAW);
    expect(signatureMatches(RAW, sig, publicKey)).toBe(true);
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(RAW.toString()), null, 2));
    expect(signatureMatches(reserialised, sig, publicKey)).toBe(false);
    expect(signatureMatches(Buffer.concat([RAW, Buffer.from(' ')]), sig, publicKey)).toBe(false);
  });
  it('the handler verifies req.rawBody (a Buffer) and never a re-serialised req.body', () => {
    const h = code('api/_handlers/inbound.ts');
    expect(h).toContain('rawBody: Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0)');
    expect(h).not.toMatch(/rawBody:\s*(Buffer\.from\()?JSON\.stringify/);
    const e = code('api/events.ts');
    expect(e).toContain('export const config = { api: { bodyParser: false } };');
    expect(e.indexOf('await attachBody(req, res)')).toBeLessThan(e.indexOf('ROUTES[action](req, res)'));
  });
});

describe('2. every other action still receives the same parsed req.body', () => {
  it('JSON → object; form → fields; text → string; empty → undefined; other → bytes; bad JSON → 400', () => {
    expect(parseBody(Buffer.from('{"a":1}'), 'application/json')).toEqual({ ok: true, body: { a: 1 } });
    expect(parseBody(Buffer.from('{"a":1}'), 'application/json; charset=utf-8')).toEqual({ ok: true, body: { a: 1 } });
    expect(parseBody(Buffer.from('a=1&b=x%20y'), 'application/x-www-form-urlencoded')).toEqual({ ok: true, body: { a: '1', b: 'x y' } });
    expect(parseBody(Buffer.from('hi'), 'text/plain')).toEqual({ ok: true, body: 'hi' });
    expect(parseBody(Buffer.alloc(0), 'application/json')).toEqual({ ok: true, body: undefined });
    expect(parseBody(Buffer.from('{oops'), 'application/json')).toEqual({ ok: false, error: 'Invalid JSON' });
    const bytes = parseBody(Buffer.from([1, 2, 3]), 'application/octet-stream');
    expect(bytes.ok && Buffer.isBuffer(bytes.body)).toBe(true);
  });
  it('attachBody sets req.body and req.rawBody once, before routing; no handler was changed to read rawBody except crm-inbound', () => {
    const b = code('api/_lib/body.ts');
    expect(b).toContain('req.rawBody = raw;');
    expect(b).toContain('req.body = parsed.body;');
    const { execSync } = require('node:child_process');
    const users = execSync("grep -l 'rawBody' api/_handlers/*.ts", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
    expect(users).toEqual(['api/_handlers/inbound.ts']);
  });
  it('still one function file: _lib and _handlers are not counted', () => {
    expect(src('api/events.ts')).toContain("from './_lib/body.js'");
  });
});

describe('3–6. the two doors', () => {
  const base = { expectedSecret: 'expected-placeholder', publicKeyPem: publicKey, rawBody: RAW };
  it('3. a valid GHL-style RSA-SHA256 signature opens the signature door', () => {
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: sign(RAW) })).toBe('signature');
  });
  it('4. an invalid signature — wrong key, tampered body, garbage, empty — is refused (null → 401)', () => {
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: sign(RAW, other.privateKey) })).toBeNull();
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: sign(Buffer.from('{"other":1}')) })).toBeNull();
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: 'not base64 at all' })).toBeNull();
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: '' })).toBeNull();
    expect(authenticateInbound({ ...base, publicKeyPem: 'not a pem', providedSecret: '', providedSignature: sign(RAW) })).toBeNull();
    expect(authenticateInbound({ ...base, publicKeyPem: '', providedSecret: '', providedSignature: sign(RAW) })).toBeNull();   // door closed when unconfigured
  });
  it('5. the secret door is unchanged: constant-time equality, first, regardless of any signature', () => {
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholder', providedSignature: '' })).toBe('secret');
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholder', providedSignature: 'junk' })).toBe('secret');
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholdeR', providedSignature: '' })).toBeNull();
    expect(authenticateInbound({ ...base, expectedSecret: '', providedSecret: 'anything', providedSignature: '' })).toBeNull();
    expect(secretMatches('', '')).toBe(false);
    expect(code('api/ghl/_inbound-auth.ts')).toContain('timingSafeEqual(a, b)');
  });
  it('6. neither credential → null; the handler answers 401 and records nothing', () => {
    expect(authenticateInbound({ ...base, providedSecret: '', providedSignature: '' })).toBeNull();
    const h = code('api/_handlers/inbound.ts');
    const refuse = h.indexOf('if (!auth) {'), record = h.indexOf(".from('ghl_inbound_events').insert(");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(record);
    expect(h.slice(refuse, h.indexOf('}', refuse + 200))).toContain("res.status(401)");
    // Unconfigured on both sides is 503, not an open door.
    expect(h).toContain('if (!expectedSecret && !publicKeyPem) {');
  });
});

describe('7–8. what the stored request says about authentication', () => {
  it('7. request.auth is the method; 8. the secret, the signature and the key never enter the row or the logs', () => {
    const h = code('api/_handlers/inbound.ts');
    expect(h).toContain('requestMeta(req, auth)');
    expect(h).not.toMatch(/providedSecret|providedSignature|publicKeyPem|expectedSecret/.source.split('|').map(v => `console\\.[a-z]+\\([^)]*${v}`).join('|'));
    // The refusal log names the step and the byte count only.
    expect(h).toMatch(/console\.error\('\[ghl-inbound\] signed request refused:'/);
    expect(h).not.toMatch(/console\.[a-z]+\([^)]*(rawBody\.toString|req\.body|providedSignature\b(?!\)))/);
    const r = code('api/ghl/_inbound-request.ts');
    expect(r).toContain("'x-wh-signature'");
    expect(r).toMatch(/DROP_FRAGMENT = \/[^/]*signature/);
  });
  it('the setting exists and is documented as pasted, never a literal', () => {
    const c = src('api/ghl/_config.ts');
    expect(c).toContain("'GHL_WEBHOOK_PUBLIC_KEY'");
    expect(c).toMatch(/copied from GHL's[\s*]+developer[\s*]+documentation by a person/);   // tolerant of the comment's line prefix
    // No PEM anywhere in the tree outside node_modules and this generated-per-run test.
    const { execSync } = require('node:child_process');
    const pems = execSync("grep -rl 'BEGIN \\(RSA \\|\\)\\(PUBLIC\\|PRIVATE\\) KEY' api src supabase docs 2>/dev/null || true", { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(pems).toBe('');
  });
});

describe('9–10, 12. capture-only, both sources, nothing enabled', () => {
  it('9. a Marketplace InboundMessage goes through the same record-first insert and the same GHL_INBOUND_ACT gate — no second path', () => {
    const h = code('api/_handlers/inbound.ts');
    expect((h.match(/from\('ghl_inbound_events'\)\.insert\(/g) ?? []).length).toBe(2);     // the insert and its pre-094 fallback
    expect((h.match(/GHL_INBOUND_ACT\.value === 'on'/g) ?? []).length).toBe(1);
    expect(h).not.toMatch(/auth === 'signature'\s*(&&|\?)/);                                   // the door never changes what happens next
    expect(h).not.toMatch(/parseInboundMessage\([^)]*auth/);
  });
  it('10. the parser, 085 and 091 are untouched by A.0', () => {
    expect(code('api/ghl/_inbound-message.ts')).not.toMatch(/signature|rawBody|auth/);
    const { execSync } = require('node:child_process');
    const changed = execSync('git status --short supabase/migrations/085_message_idempotency.sql supabase/migrations/091_conversations.sql', { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(changed).toBe('');
  });
  it('12. the acting setting is documented as off, and crm-status still reports capture unless exactly on', () => {
    expect(src('api/ghl/_config.ts')).toMatch(/NOT TO BE TURNED ON/);
    expect(code('api/_handlers/crm-status.ts')).toContain("cfg.GHL_INBOUND_ACT.value === 'on' ? 'acting' : 'capture'");
  });
});
