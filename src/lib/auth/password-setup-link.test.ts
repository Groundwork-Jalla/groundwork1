import { describe, expect, it } from 'vitest';
import { INVITED_PASSWORD_PATH, passwordSetupPathForLink } from './password-setup-link';

describe('password setup after email verification', () => {
  it.each([
    ['?token_hash=verified-token&type=invite', ''],
    ['?flow=client-invite&code=verified-code', ''],
    ['?flow=client-invite', '#access_token=verified-token&type=invite'],
    ['', '#access_token=verified-token&type=invite'],
  ])('requires a first password for invite URL %s %s', (search, hash) => {
    expect(passwordSetupPathForLink(search, hash)).toBe(INVITED_PASSWORD_PATH);
  });

  it('does not let a previous reset request turn an invite into a normal reset', () => {
    expect(passwordSetupPathForLink('?type=invite', '', 'recovery')).toBe(INVITED_PASSWORD_PATH);
  });

  it.each([
    ['?token_hash=verified-token&type=recovery', ''],
    ['?flow=recovery&code=verified-code', ''],
    ['', '#access_token=verified-token&type=recovery'],
  ])('preserves recovery URL %s %s', (search, hash) => {
    expect(passwordSetupPathForLink(search, hash)).toBe('/auth/new-password');
  });

  it('recognises a recovery requested in the same browser when PKCE omits its type', () => {
    expect(passwordSetupPathForLink('?code=verified-code', '', 'recovery')).toBe('/auth/new-password');
  });

  it('leaves ordinary signup and OAuth callbacks on their normal routing path', () => {
    expect(passwordSetupPathForLink('?token_hash=verified-token&type=signup', '')).toBeNull();
    expect(passwordSetupPathForLink('?code=verified-code', '', 'signup')).toBeNull();
  });
});
