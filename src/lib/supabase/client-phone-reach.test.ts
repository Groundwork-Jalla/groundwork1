import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A contractor-invited client can be reached on WhatsApp.
 *
 * `profiles.phone` is the ONLY thing outbound delivery resolves a destination from:
 * `conversation.ghl_contact_id`, else `profiles.ghl_contact_id`, else a contact is
 * created on demand from the phone — and with no phone the handler refuses `no_phone`
 * and nothing is sent.
 *
 * Every other way of making an account asked for a number. This one did not, so a
 * client onboarded by their contractor could never be messaged on the channel most of
 * them actually read. They would get the Groundwork email and nothing else.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const handler = strip(read('api/_handlers/contractor-invite-client.ts'));
const form    = strip(read('src/app/routes/work/clients.new.tsx'));
const lib     = strip(read('src/lib/supabase/contractor-clients.ts'));
const setPw   = strip(read('src/app/routes/auth/new-password.tsx'));

describe('the contractor supplies it, so the channel works from the first message', () => {
  it('the form asks for one, with the country picked rather than assumed', () => {
    // A diaspora client building at home often holds a foreign number; silently
    // prefixing +237 would store one that reaches nobody.
    expect(form).toMatch(/<PhoneField id="clientPhone"/);
    expect(form).toMatch(/required/);
  });

  it('and will not submit without a usable one', () => {
    expect(form).toMatch(/if \(!isValidPhone\(phone\)\) \{ setError\(t\('contractorClient\.errPhone'\)\); return; \}/);
  });

  it('it reaches the server', () => {
    expect(lib).toMatch(/JSON\.stringify\(\{ fullName, email, phone \}\)/);
  });

  it('which checks it rather than trusting the browser', () => {
    // normalisePhone returns its input unchanged when it cannot place a number, so
    // "the field had something in it" is not "this reaches a handset".
    expect(handler).toMatch(/if \(!isValidPhone\(phone\)\)\s*\{ res\.status\(400\)\.json\(\{ error: 'invalid_phone' \}\); return; \}/);
  });

  it('and stores it where delivery actually looks', () => {
    // The UPDATE specifically — the first `.from('profiles')` in this file is the
    // existing-account lookup, which selects and writes nothing.
    const at = handler.indexOf('.update({');
    expect(at, 'no profile update at all').toBeGreaterThan(-1);
    const update = handler.slice(at, handler.indexOf('})', at));
    expect(update).toMatch(/\bphone,/);
    expect(update).toMatch(/must_change_password/);
  });

  it('the refusal comes before the account is created', () => {
    // Otherwise a rejected request still leaves an account behind.
    const refuse = handler.indexOf("error: 'invalid_phone'");
    const create = handler.indexOf('auth.admin.createUser');
    expect(refuse).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(refuse);
  });
});

describe('the client can correct it at first sign-in', () => {
  it('the set-password page shows it, on the invited path only', () => {
    // Somebody resetting an ordinary password is not being asked for their phone.
    expect(setPw).toMatch(/\{mode === 'invite' && \(/);
    expect(setPw).toMatch(/<PhoneField id="client-phone"/);
  });

  it('prefilled from what the contractor gave, so leaving it alone keeps it', () => {
    expect(setPw).toMatch(/\.select\('phone'\)/);
    expect(setPw).toMatch(/setPhone\(prof\.phone as string\)/);
  });

  it('saving it cannot cost them the password they just set', () => {
    // The password is the whole reason they are on this page. A profile write that
    // failed must not take it down with it.
    const save = setPw.indexOf("update({ phone })");
    const pw   = setPw.indexOf('updateUser({ password })');
    expect(pw, 'the password is set first').toBeLessThan(save);
    expect(setPw).toMatch(/if \(r\.error\) console\.error/);
  });

  it('and an unusable number is simply not saved', () => {
    expect(setPw).toMatch(/if \(invitedClient && isE164\(phone\)\)/);
  });
});
