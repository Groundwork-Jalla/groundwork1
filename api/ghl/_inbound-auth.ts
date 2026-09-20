/**
 * Who is allowed to put an event into `ghl_inbound_events` — three doors, one answer.
 *
 * ── The workflow door: a shared secret ───────────────────────────────────────────────
 * A GoHighLevel *workflow* Webhook action lets a person set a custom header, so it sends
 * `X-Groundwork-Secret`, compared in constant time. Replayable if leaked (it was, once,
 * in a screenshot on 18 Sep 2026 — rotated the same day), which is why the endpoint
 * records and, at most, files a message.
 *
 * ── The Marketplace doors: GHL's signatures (Phase 6.2 A.0.1, 06 §16.10) ─────────────
 * A Marketplace app's webhooks are sent by GHL's platform and cannot carry our header.
 * GHL signs each delivery over the exact request bytes, base64 in a header, and
 * documents two schemes (Webhook Integration Guide, read 18 Sep 2026):
 *
 *   X-GHL-Signature  Ed25519     — the current standard
 *   X-WH-Signature   RSA-SHA256  — legacy, deprecated 1 Sep 2026, may still accompany it
 *
 * Their flow, followed exactly: when `X-GHL-Signature` is present it is THE credential —
 * verified with the Ed25519 key, and if it fails the request is refused even if a valid
 * legacy header is also present (a forger who can only produce the deprecated signature
 * must not get in by attaching a junk modern one). Only when no GHL header is present is
 * `X-WH-Signature` tried against the RSA key. Public keys are configuration pasted from
 * GHL's docs, never literals here; an unset key closes its door.
 *
 * Verification is over `rawBody` — the bytes as received, never a re-serialisation —
 * which is why `api/events.ts` keeps them. Returns which door opened, or null. Never
 * throws; a malformed key or signature is a refusal, not a crash.
 */

import { createPublicKey, createVerify, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

export type InboundAuth = 'secret' | 'ed25519' | 'rsa';

/** Constant-time compare, so a wrong secret cannot be found a character at a time. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Ed25519 over the raw bytes; base64 signature; `crypto.verify(null, …)` is Ed25519's form. */
export function ed25519Matches(rawBody: Buffer, signature: string, publicKeyPem: string): boolean {
  if (!signature || !publicKeyPem || !rawBody) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;   // the RSA key in the Ed25519 slot is a misconfiguration, not a pass
    return cryptoVerify(null, rawBody, key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** RSA-SHA256 (PKCS#1 v1.5, `createVerify('SHA256')`) over the raw bytes; base64 signature. */
export function rsaMatches(rawBody: Buffer, signature: string, publicKeyPem: string): boolean {
  if (!signature || !publicKeyPem || !rawBody) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'rsa') return false;
    return createVerify('SHA256').update(rawBody).end().verify(key, signature, 'base64');
  } catch {
    return false;
  }
}

export interface InboundCredentials {
  /** `X-Groundwork-Secret` as sent (first value if repeated), or ''. */
  providedSecret: string;
  /** The configured secret, or '' when unset. */
  expectedSecret: string;
  /** `X-GHL-Signature` as sent, or ''. */
  providedGhlSignature: string;
  /** `X-WH-Signature` as sent, or ''. */
  providedWhSignature: string;
  /** The configured Ed25519 PEM, or '' when unset. */
  ed25519PublicKeyPem: string;
  /** The configured RSA PEM, or '' when unset. */
  rsaPublicKeyPem: string;
  rawBody: Buffer;
}

/**
 *   secret → X-GHL-Signature (Ed25519) → [only if no GHL header] X-WH-Signature (RSA) → null
 */
export function authenticateInbound(c: InboundCredentials): InboundAuth | null {
  if (c.expectedSecret && c.providedSecret && secretMatches(c.providedSecret, c.expectedSecret)) return 'secret';
  if (c.providedGhlSignature) {
    // Present means decisive: verify it, and never fall through to the legacy header.
    return ed25519Matches(c.rawBody, c.providedGhlSignature, c.ed25519PublicKeyPem) ? 'ed25519' : null;
  }
  if (c.providedWhSignature && rsaMatches(c.rawBody, c.providedWhSignature, c.rsaPublicKeyPem)) return 'rsa';
  return null;
}
