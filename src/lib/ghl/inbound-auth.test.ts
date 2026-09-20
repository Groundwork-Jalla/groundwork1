import { createSign, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authenticateInbound, ed25519Matches, rsaMatches, secretMatches } from '../../../api/ghl/_inbound-auth';
import { parseBody } from '../../../api/_lib/body';

/**
 * Phase 6.2 A.0 / A.0.1 (06 §16.10–16.12) — the Marketplace doors, and the raw bytes they need.
 *
 * The key pairs below are GENERATED HERE, per run. They stand in for GHL's: same
 * algorithms, same encodings, no relation to their keys. GHL's private keys exist only at
 * GHL; their public keys are configuration a person pastes from their docs — none of that
 * is in this repo.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

type Pair = { publicKey: string; privateKey: string };
const rsaPair = (): Pair => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const edPair = (): Pair => generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const rsa = rsaPair(), rsaOther = rsaPair(), ed = edPair(), edOther = edPair();
const signRsa = (raw: Buffer, key = rsa.privateKey) => createSign('SHA256').update(raw).end().sign(key, 'base64');
const signEd = (raw: Buffer, key = ed.privateKey) => cryptoSign(null, raw, key).toString('base64');

/** A Marketplace-style body, placeholder values, with the whitespace GHL happens to send. */
const RAW = Buffer.from('{"webhookId":"wh_placeholder","type":"InboundMessage","timestamp":"2026-09-18T10:00:00.000Z","data":{"locationId":"loc_placeholder","contactId":"ct_placeholder","messageId":"msg_placeholder","body":"hello"}}');
const base = { providedSecret: '', expectedSecret: 'expected-placeholder', providedGhlSignature: '', providedWhSignature: '',
  ed25519PublicKeyPem: ed.publicKey, rsaPublicKeyPem: rsa.publicKey, rawBody: RAW };

describe('10. raw bytes are what verification sees', () => {
  it('both signatures are over the bytes as received — re-serialising the same JSON breaks them', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(RAW.toString()), null, 2));
    expect(ed25519Matches(RAW, signEd(RAW), ed.publicKey)).toBe(true);
    expect(ed25519Matches(reserialised, signEd(RAW), ed.publicKey)).toBe(false);
    expect(rsaMatches(RAW, signRsa(RAW), rsa.publicKey)).toBe(true);
    expect(rsaMatches(reserialised, signRsa(RAW), rsa.publicKey)).toBe(false);
    expect(ed25519Matches(Buffer.concat([RAW, Buffer.from(' ')]), signEd(RAW), ed.publicKey)).toBe(false);
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

describe('every other action still receives the same parsed req.body', () => {
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
  it('attachBody sets req.body and req.rawBody once, before routing; only crm-inbound reads rawBody', () => {
    const b = code('api/_lib/body.ts');
    expect(b).toContain('req.rawBody = raw;');
    expect(b).toContain('req.body = parsed.body;');
    const { execSync } = require('node:child_process');
    const users = execSync("grep -l 'rawBody' api/_handlers/*.ts", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
    expect(users).toEqual(['api/_handlers/inbound.ts']);
    expect(src('api/events.ts')).toContain("from './_lib/body.js'");
  });
});

describe('1–6. the three doors, in GHL\'s documented order', () => {
  it('1. a valid Ed25519 X-GHL-Signature → ed25519', () => {
    expect(authenticateInbound({ ...base, providedGhlSignature: signEd(RAW) })).toBe('ed25519');
  });
  it('2. Ed25519 tampered / wrong key / garbage / no key configured → null (401)', () => {
    expect(authenticateInbound({ ...base, providedGhlSignature: signEd(RAW, edOther.privateKey) })).toBeNull();
    expect(authenticateInbound({ ...base, providedGhlSignature: signEd(Buffer.from('{"other":1}')) })).toBeNull();
    expect(authenticateInbound({ ...base, providedGhlSignature: 'not base64 at all' })).toBeNull();
    expect(authenticateInbound({ ...base, ed25519PublicKeyPem: '', providedGhlSignature: signEd(RAW) })).toBeNull();
    expect(authenticateInbound({ ...base, ed25519PublicKeyPem: 'not a pem', providedGhlSignature: signEd(RAW) })).toBeNull();
    // The RSA key pasted into the Ed25519 slot is a misconfiguration, never a pass.
    expect(authenticateInbound({ ...base, ed25519PublicKeyPem: rsa.publicKey, providedGhlSignature: signEd(RAW) })).toBeNull();
  });
  it('3. X-GHL-Signature present but invalid + a VALID legacy X-WH-Signature → null: the GHL header is decisive, no fall-through', () => {
    expect(authenticateInbound({ ...base, providedGhlSignature: signEd(RAW, edOther.privateKey), providedWhSignature: signRsa(RAW) })).toBeNull();
    expect(authenticateInbound({ ...base, providedGhlSignature: 'junk', providedWhSignature: signRsa(RAW) })).toBeNull();
    // And both valid → the modern door is the one that opened.
    expect(authenticateInbound({ ...base, providedGhlSignature: signEd(RAW), providedWhSignature: signRsa(RAW) })).toBe('ed25519');
    // The flow is literal in the source: GHL header checked, returned, before the WH header is looked at.
    const a = code('api/ghl/_inbound-auth.ts');
    expect(a.indexOf('if (c.providedGhlSignature) {')).toBeLessThan(a.indexOf('c.providedWhSignature && rsaMatches('));
    expect(a).toMatch(/if \(c\.providedGhlSignature\) \{\s*return ed25519Matches\([^)]*\) \? 'ed25519' : null;\s*\}/);
  });
  it('4. legacy RSA X-WH-Signature alone, valid → rsa; invalid / wrong key / no key → null', () => {
    expect(authenticateInbound({ ...base, providedWhSignature: signRsa(RAW) })).toBe('rsa');
    expect(authenticateInbound({ ...base, providedWhSignature: signRsa(RAW, rsaOther.privateKey) })).toBeNull();
    expect(authenticateInbound({ ...base, providedWhSignature: signRsa(Buffer.from('{"other":1}')) })).toBeNull();
    expect(authenticateInbound({ ...base, rsaPublicKeyPem: '', providedWhSignature: signRsa(RAW) })).toBeNull();
    expect(authenticateInbound({ ...base, rsaPublicKeyPem: ed.publicKey, providedWhSignature: signRsa(RAW) })).toBeNull();
  });
  it('5. the secret door is unchanged: constant-time equality, first, regardless of any signature', () => {
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholder' })).toBe('secret');
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholder', providedGhlSignature: 'junk', providedWhSignature: 'junk' })).toBe('secret');
    expect(authenticateInbound({ ...base, providedSecret: 'expected-placeholdeR' })).toBeNull();
    expect(authenticateInbound({ ...base, expectedSecret: '', providedSecret: 'anything' })).toBeNull();
    expect(secretMatches('', '')).toBe(false);
    expect(code('api/ghl/_inbound-auth.ts')).toContain('timingSafeEqual(a, b)');
  });
  it('6. no credential at all → null; the handler answers 401 before any insert', () => {
    expect(authenticateInbound(base)).toBeNull();
    const h = code('api/_handlers/inbound.ts');
    const refuse = h.indexOf('if (!auth) {'), record = h.indexOf(".from('ghl_inbound_events').insert(");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(record);
    expect(h.slice(refuse, record)).toContain('res.status(401)');
  });
  it('7. nothing configured on any door → 503, never open', () => {
    expect(code('api/_handlers/inbound.ts')).toContain('if (!expectedSecret && !ed25519PublicKeyPem && !rsaPublicKeyPem) {');
    expect(authenticateInbound({ ...base, expectedSecret: '', ed25519PublicKeyPem: '', rsaPublicKeyPem: '', providedSecret: 'x', providedGhlSignature: signEd(RAW), providedWhSignature: signRsa(RAW) })).toBeNull();
  });
});

describe('8–9. what the stored request says about authentication', () => {
  it('8. request.auth is the door — secret | ed25519 | rsa — 9. and no signature, key or secret enters the row or the logs', () => {
    const h = code('api/_handlers/inbound.ts');
    expect(h).toContain('requestMeta(req, auth)');
    expect(h).toMatch(/console\.error\('\[ghl-inbound\] signed request refused:'/);
    // Every console call in the handler: none prints a credential, a key, or the body.
    for (const call of h.match(/console\.[a-z]+\([\s\S]*?\);/g) ?? []) {
      expect(call).not.toMatch(/providedSecret|providedGhlSignature\s*[,)]|providedWhSignature\s*[,)]|PublicKeyPem\s*[,)]|expectedSecret|rawBody\.toString|req\.body|payload/);
    }
    const r = code('api/ghl/_inbound-request.ts');
    expect(r).toContain("'x-ghl-signature'");
    expect(r).toContain("'x-wh-signature'");
    expect(r).toMatch(/DROP_FRAGMENT = \/[^/]*signature/);
    expect(r).toContain("auth: 'secret' | 'ed25519' | 'rsa' | null");
  });
  it('the two settings exist, documented as pasted; the old single key is gone; no PEM in the tree', () => {
    const c = src('api/ghl/_config.ts');
    expect(c).toContain("'GHL_WEBHOOK_PUBLIC_KEY_ED25519'");
    expect(c).toContain("'GHL_WEBHOOK_PUBLIC_KEY_RSA'");
    expect(c).not.toMatch(/'GHL_WEBHOOK_PUBLIC_KEY'/);
    expect(c).toMatch(/copied from GHL's[\s*]+developer[\s*]+documentation[\s*]+\(Webhook Integration[\s*]+Guide\) by a person/);
    const { execSync } = require('node:child_process');
    const pems = execSync("grep -rl 'BEGIN \\(RSA \\|\\)\\(PUBLIC\\|PRIVATE\\) KEY' api src supabase docs 2>/dev/null || true", { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(pems).toBe('');
  });
});

describe('11, 13. capture-only, both sources, nothing enabled', () => {
  it('11. a Marketplace event goes through the same record-first insert and the same GHL_INBOUND_ACT gate — the door never changes what happens next', () => {
    const h = code('api/_handlers/inbound.ts');
    expect((h.match(/from\('ghl_inbound_events'\)\.insert\(/g) ?? []).length).toBe(2);     // the insert and its pre-094 fallback
    expect((h.match(/GHL_INBOUND_ACT\.value === 'on'/g) ?? []).length).toBe(1);
    expect(h).not.toMatch(/auth === '(ed25519|rsa|secret)'\s*(&&|\?)/);
    expect(h).not.toMatch(/parseInboundMessage\([^)]*auth/);
  });
  it('the parser, 085 and 091 are untouched', () => {
    expect(code('api/ghl/_inbound-message.ts')).not.toMatch(/signature|rawBody|auth|webhookId/);
    const { execSync } = require('node:child_process');
    const changed = execSync('git status --short supabase/migrations/085_message_idempotency.sql supabase/migrations/091_conversations.sql', { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(changed).toBe('');
  });
  it('13. the acting setting is documented as off, and crm-status still reports capture unless exactly on', () => {
    expect(src('api/ghl/_config.ts')).toMatch(/NOT TO BE TURNED ON/);
    expect(code('api/_handlers/crm-status.ts')).toContain("cfg.GHL_INBOUND_ACT.value === 'on' ? 'acting' : 'capture'");
  });
});
