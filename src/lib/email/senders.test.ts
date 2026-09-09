import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SENDER, senderFor } from './senders';

/**
 * One place that knows who we send as.
 *
 * The same sender string was written out ten times across nine files. That is why
 * "send certificates from their own address" was a ten-file change, and why a single
 * missed copy could quietly go out as something else.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const KEYS = [
  'EMAIL_FROM_APPLICATIONS', 'EMAIL_FROM_INVITES',
  'EMAIL_FROM_CERTIFICATES', 'EMAIL_FROM_DEFAULT',
];

afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('senderFor', () => {
  it('sends everything from the one verified address by default', () => {
    // Nothing changes address until the new mailbox is verified in Resend. Pointing
    // certificates at an unverified `certificates@` would not make them prettier; it
    // would make them fail to send.
    for (const kind of ['stage_update', 'contractor_invite', 'other'] as const) {
      expect(senderFor(kind)).toBe(DEFAULT_SENDER);
    }
    expect(DEFAULT_SENDER).toContain('mail.tryjalla.com');
  });

  it('lets one purpose move without moving the rest', () => {
    process.env.EMAIL_FROM_CERTIFICATES = 'Groundwork <certificates@mail.tryjalla.com>';
    expect(senderFor('stage_update')).toBe('Groundwork <certificates@mail.tryjalla.com>');
    expect(senderFor('contractor_invite')).toBe(DEFAULT_SENDER);
  });

  it('treats a blank variable as unset', () => {
    // An empty string in a dashboard is a far easier mistake than a wrong address, and
    // it must never produce a send with no From header.
    process.env.EMAIL_FROM_CERTIFICATES = '   ';
    expect(senderFor('stage_update')).toBe(DEFAULT_SENDER);
  });

  it('falls back through the default variable before the built-in', () => {
    process.env.EMAIL_FROM_DEFAULT = 'Groundwork <hello@mail.tryjalla.com>';
    expect(senderFor('other')).toBe('Groundwork <hello@mail.tryjalla.com>');
    expect(senderFor('contractor_invite')).toBe('Groundwork <hello@mail.tryjalla.com>');
  });
});

describe('nobody writes the address out again', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(e => {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(e) ? [relative(ROOT, full)] : [];
    });
  }

  it('has exactly one literal sender in the codebase', () => {
    // Several endpoints explain in prose that they send as noreply@ and why that makes
    // them worth locking down. Only code counts as a duplicate.
    const stripComments = (src: string) =>
      src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

    const offenders = [...walk(join(ROOT, 'api')), ...walk(join(ROOT, 'src'))]
      .filter(f => !f.startsWith('src/lib/email/senders.'))
      .filter(f => /noreply@mail\.tryjalla\.com/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
    expect(offenders, `\n  ${offenders.join('\n  ')}\n`).toEqual([]);
  });

  it('does not let a browser caller choose the From address', () => {
    // `kind` arrives in the request body. Unsanitised, it would pick the sender as well
    // as the CRM note label — and CALLER_ASSIGNABLE exists to stop an admin's browser
    // claiming to be an application decision.
    const send = readFileSync(join(ROOT, 'api/send-email.ts'), 'utf8');
    expect(send).toMatch(/const emailKind = callerEmailKind\(kind\)/);
    expect(send).toMatch(/senderFor\(emailKind\)/);
    expect(send, 'the raw body value must not reach senderFor').not.toMatch(/senderFor\(kind\)/);
  });
});
