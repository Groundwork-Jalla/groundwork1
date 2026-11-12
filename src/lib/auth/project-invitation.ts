import { isSafeInternalPath } from './post-auth-path';

export type ProjectInvitation = { kind: 'contractor' | 'viewer'; token: string };
type InvitationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const keys = { contractor: 'pendingInvite', viewer: 'pendingProjectShare' } as const;
const tokenPattern = /^[a-zA-Z0-9_-]{1,200}$/;

function browserStorage(): InvitationStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

function token(value: string | null): string | null {
  return value && tokenPattern.test(value) ? value : null;
}

/** URL context survives email confirmation on another device; storage is a fallback. */
export function readProjectInvitation(
  search = '', storage: InvitationStorage | undefined = browserStorage(),
): ProjectInvitation | null {
  const params = new URLSearchParams(search);
  const viewer = token(params.get('share'));
  if (viewer) return { kind: 'viewer', token: viewer };
  const contractor = token(params.get('invite'));
  if (contractor) return { kind: 'contractor', token: contractor };
  const path = params.get('redirect')?.match(/^\/(share|invite)\/([a-zA-Z0-9_-]{1,200})\/?$/);
  if (path) return { kind: path[1] === 'share' ? 'viewer' : 'contractor', token: path[2] };
  try {
    for (const kind of ['viewer', 'contractor'] as const) {
      const saved = token(storage?.getItem(keys[kind]) ?? null);
      if (saved) return { kind, token: saved };
    }
  } catch { /* The URL remains sufficient when browser storage is unavailable. */ }
  return null;
}

export function rememberProjectInvitation(
  invitation: ProjectInvitation, storage: InvitationStorage | undefined = browserStorage(),
): void {
  if (!token(invitation.token)) return;
  try {
    storage?.setItem(keys[invitation.kind], invitation.token);
    storage?.removeItem(keys[invitation.kind === 'viewer' ? 'contractor' : 'viewer']);
  } catch { /* Authentication links carry the same context without storage. */ }
}

/** A slower acceptance must not clear a newer invitation opened in another tab. */
export function forgetProjectInvitation(
  invitation: ProjectInvitation, storage: InvitationStorage | undefined = browserStorage(),
): void {
  try {
    if (storage?.getItem(keys[invitation.kind]) === invitation.token) {
      storage.removeItem(keys[invitation.kind]);
    }
  } catch { /* The accepted database membership is already durable. */ }
}

export function projectInvitationPath(invitation: ProjectInvitation): string {
  return `/${invitation.kind === 'viewer' ? 'share' : 'invite'}/${encodeURIComponent(invitation.token)}`;
}

export function projectInvitationError(error: unknown): 'invite.emailMismatch' | 'invite.acceptError' | 'invite.projectPreparing' | 'projectLinks.unavailable' | 'projectLinks.verifyEmail' | 'projectLinks.pendingForAccount' | 'teamAccess.alreadyMember' {
  const detail = error as { code?: string; message?: string } | null;
  const message = `${detail?.code ?? ''} ${detail?.message ?? ''}`;
  if (message.includes('invitation_access_pending')) return 'invite.projectPreparing';
  if (/invitation_expired|revoked|already_accepted|invite_invalid|invalid_token/.test(message)) return 'projectLinks.unavailable';
  if (message.includes('invitation_email_unverified')) return 'projectLinks.verifyEmail';
  if (message.includes('invitation_pending')) return 'projectLinks.pendingForAccount';
  if (message.includes('already_member')) return 'teamAccess.alreadyMember';
  return message.includes('invite_email_mismatch')
    ? 'invite.emailMismatch' : 'invite.acceptError';
}

export function withProjectInvitation(path: string, invitation: ProjectInvitation | null): string {
  if (!invitation) return path;
  const url = new URL(path, 'https://groundwork.invalid');
  url.searchParams.set(invitation.kind === 'viewer' ? 'share' : 'invite', invitation.token);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Only app paths, never protocol-relative or backslash-normalised external URLs. */
export function safeAuthReturn(path: string | null): string | null {
  return isSafeInternalPath(path) && !/[\\\u0000-\u001f\u007f]/.test(path) ? path : null;
}

/** Onboarding may return to an assigned project, never back into its own gate. */
export function contractorProjectReturn(path: string | null): string | null {
  const safe = safeAuthReturn(path);
  return safe && /^\/work\/projects\/[a-zA-Z0-9_-]+(?:\?[^#]*)?(?:#.*)?$/.test(safe) ? safe : null;
}

export function projectAuthCallbackUrl(origin: string, search = ''): string {
  const invitation = readProjectInvitation(search);
  if (invitation) rememberProjectInvitation(invitation);
  const callback = new URL(withProjectInvitation('/auth/callback', invitation), origin);
  const redirect = safeAuthReturn(new URLSearchParams(search).get('redirect'));
  if (redirect) callback.searchParams.set('redirect', redirect);
  return callback.href;
}
