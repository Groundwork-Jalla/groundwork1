import { describe, it, expect } from 'vitest';
import { isValidEmail } from './is-valid-email';

describe('isValidEmail', () => {
  // The exact address that reached the waitlist and then failed every downstream step:
  // the GHL mirror rejected it and no welcome email could be delivered.
  it('rejects an address with no TLD, which <input type="email"> accepts', () => {
    expect(isValidEmail('nwachukwufac@gmail')).toBe(false);
  });

  // The exact address on the contractor application that could never be acknowledged:
  // a trailing dot on the local part. The old rule only looked for a dot in the domain,
  // so this was accepted at submission and then rejected by Resend (422) on every send,
  // for ever. See the note in is-valid-email.ts.
  it('rejects a trailing dot on the local part', () => {
    expect(isValidEmail('ngamfonjoel.@gmail.com')).toBe(false);
  });

  it.each([
    'nwachukwufac@gmail.com',
    'favour@tryjalla.com',
    'a.b+tag@sub.domain.co.uk',
    "o'brien@mail.tryjalla.com",
    'jean-luc@entreprise-btp.cm',
  ])('accepts %s', (e) => expect(isValidEmail(e)).toBe(true));

  // Every one of these was verified against the Resend API: each answers 422
  // validation_error, so accepting them here would only defer the failure to a send
  // nobody can retry their way out of.
  it.each([
    '', 'no-at-sign', '@nolocal.com', 'spaces in@mail.com', 'trailing@dot.',
    '.leading@gmail.com',      // dot may not lead the local part
    'double..dot@gmail.com',   // nor repeat
    'user@.gmail.com',         // nor lead the domain
    'user@-gmail.com',         // a label may not start with a hyphen
    'user@gmail-.com',         // nor end with one
    'usér@gmail.com',          // Resend: "contains non-ASCII characters"
  ])('rejects %s', (e) => expect(isValidEmail(e)).toBe(false));

  it('is case- and whitespace-insensitive, matching what we store', () => {
    expect(isValidEmail('  Favour@TryJalla.com  ')).toBe(true);
  });
});
