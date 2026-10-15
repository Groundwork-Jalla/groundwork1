import type { AuthEmailFlow } from './last-email-request';

export const INVITED_PASSWORD_PATH = '/auth/new-password?first=1&reason=client-invite';

/** Resolve the link's purpose before Supabase consumes its fragment or PKCE code. */
export function passwordSetupPathForLink(
  search: string,
  fragment: string,
  pendingFlow?: AuthEmailFlow,
): string | null {
  const query = new URLSearchParams(search);
  const hash = new URLSearchParams(fragment.replace(/^#/, ''));
  const type = query.get('type') ?? hash.get('type');

  // An explicit invite wins over an unrelated reset remembered in this browser.
  // The flow marker also survives PKCE redirects, which carry no Supabase `type`.
  if (type === 'invite' || query.get('flow') === 'client-invite') {
    return INVITED_PASSWORD_PATH;
  }
  if (type === 'recovery' || query.get('flow') === 'recovery' || pendingFlow === 'recovery') {
    return '/auth/new-password';
  }
  return null;
}
