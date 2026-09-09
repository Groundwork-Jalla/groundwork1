import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The chat ↔ GoHighLevel round trip, guarded at the three points where it fails silently.
 *
 * Every one of these is invisible when broken: the mirror is fire-and-forget behind a
 * `catch {}`, so a 401 or a missing flag produces no error anywhere — just a CRM that
 * quietly stops seeing conversations, or a thread that fills with its own echo.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the chat mirror cannot echo', () => {
  it('marks GHL-authored replies so they are never sent back', () => {
    // A reply from GHL becomes a project_messages row; a project_messages row gets
    // mirrored to GHL; the mirror arrives as a new reply. `origin` is the only thing
    // between that and a thread that fills forever.
    const delivery = read('api/_handlers/conversation-delivery.ts');
    expect(delivery, 'GHL replies must be filed with origin ghl')
      .toMatch(/origin:\s*'ghl'/);

    const mirror = read('api/_handlers/project-message.ts');
    expect(mirror, 'the mirror must refuse anything not written here')
      .toMatch(/origin\s*!==\s*'platform'/);
  });

  it('does not let the browser choose the origin', () => {
    // Without the trigger, `origin` is just a column on an INSERT the client controls,
    // and any sender could opt their messages out of the CRM.
    const sql = read('supabase/migrations/077_chat_ghl_mirror.sql');
    expect(sql).toMatch(/pin_project_message_origin/);
    expect(sql).toMatch(/BEFORE INSERT ON public\.project_messages/);
    expect(sql, 'the pin must key on there being a session, not on a client flag')
      .toMatch(/auth\.uid\(\)\s+IS NOT NULL/);
  });

  it('mirrors each message at most once', () => {
    const mirror = read('api/_handlers/project-message.ts');
    expect(mirror, 'an already-mirrored message must short-circuit')
      .toMatch(/if \(msg\.ghl_message_id\)/);
  });
});

describe('the mirror is actually reachable', () => {
  it('sends the access token the handler requires', () => {
    // `requireUser` reads the Supabase JWT off the Authorization header and returns null
    // without one. Since the call is fire-and-forget, a missing header means every mirror
    // 401s and nothing anywhere says so.
    const lib = read('src/lib/supabase/messages.ts');
    expect(lib).toMatch(/action=crm-chat-mirror/);
    expect(lib, 'the mirror call must carry the session token')
      .toMatch(/Authorization:\s*`Bearer \$\{session\.access_token\}`/);
  });

  it('is registered as an action, since api/ is capped at 12 functions', () => {
    const events = read('api/events.ts');
    expect(events).toMatch(/'crm-chat-mirror'/);
    expect(events).toMatch(/_handlers\/project-message\.js/);
  });

  it('never turns a CRM outage into a failed send', () => {
    // The message is stored and on the recipient's screen before the mirror is attempted.
    const lib = read('src/lib/supabase/messages.ts');
    expect(lib, 'the mirror must not be awaited into the send path').toMatch(/void mirrorToCrm\(/);

    const mirror = read('api/_handlers/project-message.ts');
    // Every failure path answers 200: a chat box has nothing useful to do with a 5xx.
    expect(mirror).not.toMatch(/res\.status\(50\d\)\.json\(\{ error: 'ghl/);
  });
});

describe('a reply knows which project it belongs to', () => {
  it('stamps the thread on the way out and reads it on the way in', () => {
    // A GHL conversation is per contact, so a reply carries no project. The outbound
    // mirror records which project the thread was last about; the inbound files against
    // it. If either half goes, replies land in the wrong chat or in none.
    expect(read('api/_handlers/project-message.ts')).toMatch(/ghl_thread_project_id/);
    expect(read('api/_handlers/conversation-delivery.ts')).toMatch(/ghl_thread_project_id/);
    expect(read('supabase/migrations/077_chat_ghl_mirror.sql')).toMatch(/ghl_thread_project_id/);
  });

  it('files nothing rather than guessing when the thread has no project', () => {
    expect(read('api/_handlers/conversation-delivery.ts')).toMatch(/no_thread_project/);
  });
});

/**
 * A reply that reaches the chat must not also arrive in full by email.
 *
 * Product rule, 9 Sep 2026: every form of contact happens inside Groundwork. A reply
 * whose text is sitting in a mailbox is a conversation that has left the platform — the
 * recipient answers from their mail client and the thread splits in two.
 *
 * The email becomes a doorbell in that case. It stays a full copy only when the reply
 * could NOT be filed, because a notification pointing at a message that does not exist
 * is worse than an email that leaves the platform.
 */
describe('the reply email is a doorbell, not the room', () => {
  const delivery = read('api/_handlers/conversation-delivery.ts');

  it('files into the chat before deciding what to send', () => {
    const fileAt = delivery.indexOf('await fileIntoProjectChat(');
    const sendAt = delivery.indexOf('https://api.resend.com/emails');
    expect(fileAt).toBeGreaterThan(-1);
    expect(fileAt, 'the send must not be composed before the filing result is known')
      .toBeLessThan(sendAt);
  });

  it('sends a link, not the body, once the message is in the chat', () => {
    expect(delivery).toMatch(/filing\.filed \? notifyHtml : html/);
    expect(delivery).toMatch(/filing\.filed \? 'You have a new message' : subject/);
  });

  it('keeps the full text when there was nowhere in-platform to put it', () => {
    // no_thread_project / no_service_key / insert_failed all land here. Losing the reply
    // entirely would be a far worse failure than an email carrying it.
    expect(delivery).toMatch(/filing\.filed \? undefined\s+: text/);
  });

  it('does not invite an off-platform answer on the notification', () => {
    // Reply-To, cc and bcc are the full-text path only: a doorbell with a Reply-To is an
    // invitation to answer by email, which is the thing being avoided.
    for (const field of ['reply_to', 'cc', 'bcc']) {
      const m = delivery.match(new RegExp(`\\.\\.\\.\\([^)]*${field}[^)]*\\)`));
      expect(m?.[0], `${field} must be gated on the full-text path`).toMatch(/!filing\.filed/);
    }
  });
});

describe('the draft that shipped before the rule is gone', () => {
  it('drops contractor_contacts rather than leaving it revoked', () => {
    // 075 was rewritten to remove it, but a rewrite is only true of the FILE — a database
    // that ran the earlier draft still had the function. Confirmed live: it answered
    // 42501, not PGRST202.
    const sql = read('supabase/migrations/078_drop_contractor_contacts.sql');
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.contractor_contacts\(\)/);
    expect(sql).toMatch(/REVOKE ALL\s+ON FUNCTION public\.contractor_directory_entitled\(\) FROM PUBLIC, anon/);
  });
});
