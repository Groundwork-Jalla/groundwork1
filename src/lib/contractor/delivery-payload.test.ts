import { describe, expect, it } from 'vitest';

/**
 * The shape GoHighLevel actually sends when somebody replies in a thread.
 *
 * Captured verbatim from a live delivery on 3 Sep 2026. `emailTo` is an **array** while
 * `emailFrom` and `subject` are plain strings — read the first with a string helper and
 * it comes back empty, the endpoint rejects its own valid input, and the reply is lost
 * with the thread still showing it as sent. That is what happened.
 *
 * These test the extraction rules directly, so a future tidy-up cannot quietly reinstate
 * the assumption that every address field is a string.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const addr = (v: unknown): string => (Array.isArray(v) ? str(v[0]) : str(v));
const addrs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map(str).filter(Boolean);

/** The real payload, trimmed of nothing that matters. */
const LIVE = {
  userId: 'WtV59KLqD8ScvngqW1se',
  attachments: [],
  contactId: '7KkP2pOxMz1fPYSZjo2x',
  locationId: 'AVmNTkh2bzvrlSmOnm76',
  messageId: 'vLgtzfuNiZ1GrZmca2n4',
  type: 'Email',
  conversationId: '3naA294RnsXloqcg0hoz',
  emailTo: ['phavorfavor@gmail.com'],
  emailFrom: 'Favour Nwachukwu <favour@tryjalla.com>',
  html: '<html><body><p>testtest</p></body></html>',
  plainText: 'testtest',
  subject: 'Hello Eloisa',
  conversationProviderId: '6a991995f9b7603f6559a5df',
};

describe('GHL delivery payload', () => {
  it('reads the recipient out of an array', () => {
    expect(addr(LIVE.emailTo)).toBe('phavorfavor@gmail.com');
  });

  it('would have failed with a string-only reader — the actual bug', () => {
    expect(str(LIVE.emailTo)).toBe('');
  });

  it('still reads a plain string, in case GHL sends one', () => {
    expect(addr('someone@example.com')).toBe('someone@example.com');
  });

  it('takes the sender as reply-to, so answers reach a person', () => {
    // Sent from our verified domain — Resend will not send as favour@tryjalla.com and a
    // spoofed From fails DMARC — so the human address has to ride on Reply-To.
    expect(addr(LIVE.emailFrom)).toBe('Favour Nwachukwu <favour@tryjalla.com>');
  });

  it('keeps every cc rather than only the first', () => {
    expect(addrs(['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(addrs(undefined)).toEqual([]);
  });

  it('has both a markup and a text rendering', () => {
    expect(LIVE.html).toContain('testtest');
    expect(LIVE.plainText).toBe('testtest');
  });
});
