import { describe, it, expect } from 'vitest';
import { isValidEmail } from './is-valid-email';

describe('isValidEmail', () => {
  // The exact address that reached the waitlist and then failed every downstream step:
  // the GHL mirror rejected it and no welcome email could be delivered.
  it('rejects an address with no TLD, which <input type="email"> accepts', () => {
    expect(isValidEmail('nwachukwufac@gmail')).toBe(false);
  });

  it.each([
    'nwachukwufac@gmail.com',
    'favour@tryjalla.com',
    'a.b+tag@sub.domain.co.uk',
  ])('accepts %s', (e) => expect(isValidEmail(e)).toBe(true));

  it.each(['', 'no-at-sign', '@nolocal.com', 'spaces in@mail.com', 'trailing@dot.'])(
    'rejects %s', (e) => expect(isValidEmail(e)).toBe(false),
  );

  it('is case- and whitespace-insensitive, matching what we store', () => {
    expect(isValidEmail('  Favour@TryJalla.com  ')).toBe(true);
  });
});
