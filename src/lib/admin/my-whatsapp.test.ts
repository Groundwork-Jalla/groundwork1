import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A person can see the channel that reaches their own phone.
 *
 * Reported from testing: a contractor saw a WhatsApp tab in Messages and the client saw
 * only Groundwork. Not a rendering difference — a `whatsapp` conversation row was only
 * ever created by three things (an admin pressing the WhatsApp button, a message arriving
 * FROM that phone, or 126's fan-out), and none had ever happened to the client. So there
 * was nothing to list.
 *
 * The security property pinned hardest here: this endpoint takes NO person parameter, so
 * it cannot be aimed at anybody else, which is the only reason it needs no admin check.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

const handler = code('api/_handlers/my-whatsapp.ts');
const client  = code('src/lib/supabase/my-whatsapp.ts');
const project = code('src/components/project/ProjectConversations.tsx');
const events  = code('api/events.ts');

describe('it can only ever be your own thread', () => {
  it('the subject comes from the token, never the body', () => {
    expect(handler).toMatch(/await asCaller\.auth\.getUser\(\)/);
    expect(handler).toMatch(/const personId = me\?\.user\?\.id/);
  });

  it('and there is no person parameter to tamper with', () => {
    // THE security property. `project-whatsapp` takes a recipient and a personId and is
    // admin-gated for exactly that reason; this one is a different endpoint rather than
    // that one with its check relaxed.
    expect(handler).not.toMatch(/req\.body\?\.personId|req\.body\?\.recipient|req\.body\?\.projectId/);
    expect(handler).not.toMatch(/resolveRecipient/);
  });

  it('the caller still has to be signed in', () => {
    expect(handler).toMatch(/if \(!token\)[\s\S]{0,80}401/);
    expect(handler).toMatch(/if \(whoErr \|\| !personId\)[\s\S]{0,80}401/);
  });

  it('and the browser never holds the provider token', () => {
    // It talks to GoHighLevel, and 091 writes conversations through privileged paths only.
    expect(handler).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(client).not.toMatch(/ghl|GHL|SERVICE_ROLE/);
  });
});

describe('the thread rule is the shared one', () => {
  it('not a second implementation of "one person, one chat"', () => {
    expect(handler).toMatch(/resolveOrEstablishWhatsApp\(svc, personId\)/);
    expect(handler).not.toMatch(/upsertContact|ensureConversation|from\('conversations'\)/);
  });
});

describe('no phone on file is an answer, not a failure', () => {
  it('it comes back 200 with a reason', () => {
    // A broken page would be the wrong way to say "we have no number for you".
    expect(handler).toMatch(/res\.status\(200\)\.json\(\{ ok: false, reason: thread\.reason \}\)/);
  });

  it('and Messages still renders when it refuses', () => {
    expect(client).toMatch(/catch \{[\s\S]{0,200}return false;/);
    expect(client).toMatch(/if \(!r\.ok\) return false;/);
  });
});

describe('establishing a thread does not happen on every navigation', () => {
  it('once per person per page load', () => {
    // It talks to the provider; a page view must not.
    expect(client).toMatch(/const attempted = new Set<string>\(\)/);
    expect(client).toMatch(/if \(attempted\.has\(userId\)\) return false;/);
    expect(client).toMatch(/attempted\.add\(userId\)/);
  });

  it('and only when there is no WhatsApp thread already', () => {
    expect(project).toMatch(/!mine\.rows\.some\(r => r\.channel === 'whatsapp'\) && userId/);
  });

  it('re-listing only when something was actually created', () => {
    // `found` means it was already in the list we just read.
    expect(client).toMatch(/json\?\.created === true/);
    expect(project).toMatch(/if \(await ensureMyWhatsApp\(userId\)\) mine = await listMyConversations\(\)/);
  });
});

describe('the endpoint is wired up', () => {
  it('registered, and typed into the action union', () => {
    expect(events).toMatch(/'my-whatsapp': myWhatsApp/);
    expect(events).toMatch(/\| 'message-fanout' \| 'my-whatsapp';/);
  });

  it('and it is not one of the admin-only actions', () => {
    // A quick guard against somebody later copying the admin preamble into it.
    expect(handler).not.toMatch(/rpc\('is_admin'\)/);
    expect(handler).not.toMatch(/Admins only/);
  });
});

describe('it does not re-fire on a token refresh', () => {
  it('the dependency is the id, not the user object', () => {
    // `useAuth()` hands back a new object on every refresh; depending on it would re-run
    // the load and re-list the threads for no reason.
    expect(project).toMatch(/const userId = user\?\.id \?\? null;/);
    expect(project).toMatch(/\}, \[projectId, t, userId\]\);/);
  });
});
