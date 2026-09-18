/**
 * Who is allowed to put an event into `ghl_inbound_events` — two doors, one answer.
 *
 * ── The workflow door: a shared secret ───────────────────────────────────────────────
 * A GoHighLevel *workflow* Webhook action lets a person set a custom header, so it sends
 * `X-Groundwork-Secret`, compared in constant time. Replayable if leaked (it was, once,
 * in a screenshot on 18 Sep 2026 — rotated the same day), which is why the endpoint
 * records and, at most, files a message.
 *
 * ── The Marketplace door: GHL's signature (Phase 6.2 A.0, 06 §16.10) ─────────────────
 * A Marketplace app's webhooks are sent by GHL's platform and cannot carry our header.
 * GHL signs each delivery instead: `x-wh-signature` is a base64 RSA-SHA256 signature over
 * the exact request bytes, made with GHL's private key; we verify with the public key GHL
 * publishes (`GHL_WEBHOOK_PUBLIC_KEY`, pasted from their documentation, never a literal
 * here). This is the stronger door — a forged request would need GHL's private key, and a
 * captured request cannot be altered without breaking the signature.
 *
 * Verification is over `rawBody` — the bytes as received, never a re-serialisation — which
 * is why `api/events.ts` keeps them. If GHL's real scheme differs from the documented one
 * (a different digest, say), the first real delivery is a 401 with a log line naming the
 * step that failed, not a silent drop: that log is the evidence to correct this against.
 *
 * Returns which door opened, or null. Never throws; a malformed key or signature is a
 * refusal, not a crash.
 */

import { createVerify, timingSafeEqual } from 'node:crypto';

export type InboundAuth = 'secret' | 'signature';

/** Constant-time compare, so a wrong secret cannot be found a character at a time. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** RSA-SHA256 (PKCS#1 v1.5, `createVerify('SHA256')`) over the raw bytes, base64 signature. */
export function signatureMatches(rawBody: Buffer, signature: string, publicKeyPem: string): boolean {
  if (!signature || !publicKeyPem || !rawBody) return false;
  try {
    return createVerify('SHA256').update(rawBody).end().verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;   // unparseable key or signature: refuse, don't crash
  }
}

export interface InboundCredentials {
  /** `X-Groundwork-Secret` as sent (first value if repeated), or ''. */
  providedSecret: string;
  /** The configured secret, or '' when unset. */
  expectedSecret: string;
  /** `x-wh-signature` as sent, or ''. */
  providedSignature: string;
  /** The configured PEM, or '' when unset. */
  publicKeyPem: string;
  rawBody: Buffer;
}

/**
 * The secret first (cheap, and the door in use today), then the signature. A request that
 * presents both must satisfy at least one; neither → null → 401.
 */
export function authenticateInbound(c: InboundCredentials): InboundAuth | null {
  if (c.expectedSecret && c.providedSecret && secretMatches(c.providedSecret, c.expectedSecret)) return 'secret';
  if (c.publicKeyPem && c.providedSignature && signatureMatches(c.rawBody, c.providedSignature, c.publicKeyPem)) return 'signature';
  return null;
}
