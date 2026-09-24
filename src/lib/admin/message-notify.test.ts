import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 097 — staff writing to a client actually tells them.
 *
 * Native messaging worked in both directions but only told anybody in one:
 * `notify_project_members` (013) is called from the CLIENT's chat, so a client writing in
 * notified staff, and staff writing back notified nobody. The team could send "the
 * verifier needs more foundation photos" and the client would find out whenever they next
 * happened to open the project.
 *
 * Proven against PostgreSQL 16 with real rows: one outbound staff message notifies the
 * client once; an internal note notifies nobody; the client's own reply notifies neither
 * of them; and an author who is also the thread's person is still not notified.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const sql = readFileSync(resolve(ROOT, 'supabase/migrations/097_message_notifies_client.sql'), 'utf8');
/** The statements alone. The comments explain what is deliberately NOT done, and would
 *  otherwise trip every ban below by naming it. */
const code = sql.replace(/^\s*--.*$/gm, '');

describe('who gets told', () => {
  it('only what staff sent outward', () => {
    expect(sql).toContain("IF NEW.direction IS DISTINCT FROM 'outbound' THEN RETURN NEW; END IF;");
  });

  it('an internal note is never mentioned, not even in a subject line', () => {
    // It is staff-only by definition (091); a notification would leak that it exists.
    // The function body only: the COMMENT ON after it documents the rule, and saying
    // "internal is staff-only" there is the opposite of leaking it.
    const start = code.indexOf('AS $$');
    const body = code.slice(start, code.indexOf('$$;', start));
    expect(body).not.toMatch(/internal/i);
  });

  it('never the author — including an author who is also the thread\'s person', () => {
    expect(sql).toContain('IF v_conv.person_id = NEW.sender_id THEN RETURN NEW; END IF;');
  });

  it('the person on the conversation, never a project member list', () => {
    // 013 fans out to owner + contractors. This is a reply to one thread, so it goes to
    // the one person that thread is with.
    expect(code).toContain('v_conv.person_id');
    expect(code).not.toContain('notify_project_members');
    expect(code).not.toContain('contractor_invites');
  });
});

describe('the message itself never leaves Groundwork', () => {
  it('the email says a message is waiting and where to read it', () => {
    expect(sql).toContain('You have a new message from the Groundwork team about');
    // The content goes in the in-app body only, never into the mail.
    const mail = sql.slice(sql.indexOf('body_html :='), sql.indexOf('net.http_post'));
    expect(mail).not.toContain('NEW.content');
  });

  it('it links to the project\'s own Messages tab', () => {
    expect(code).toContain('?tab=messages');
    expect(code).toContain('v_conv.project_id::text');
  });

  it('everything is escaped', () => {
    for (const v of ['v_project.name', 'v_name', 'v_preview']) {
      expect(sql, v).toMatch(new RegExp(`html_escape\\([^)]*${v.replace('.', '\\.')}`));
    }
  });
});

describe('it can never cost the message', () => {
  it('fires after the insert, so nothing it does rolls one back', () => {
    expect(sql).toContain('AFTER INSERT ON public.project_messages');
  });

  it('the bell and the email each fail on their own', () => {
    expect((sql.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/client notification failed/);
    expect(sql).toMatch(/client email failed/);
  });

  it('an unconfigured mailer is a warning, not a failure', () => {
    expect(sql).toContain('no resend_api_key in app_config');
    expect(sql).toContain('RETURN NEW;');
  });

  it('a thread with no project still rings the bell but sends no email', () => {
    // The mail names a project; a person-level thread has none to name.
    expect(sql).toContain("IF v_email IS NULL OR v_email = '' OR v_project.id IS NULL THEN RETURN NEW; END IF;");
  });
});

describe('it is reachable from every route, because it is not in a screen', () => {
  it('a trigger on the row, not a call in the Inbox', () => {
    expect(sql).toContain('CREATE TRIGGER trg_notify_client_of_message');
    expect(sql).toContain('EXECUTE FUNCTION public.notify_client_of_message()');
  });

  it('locked down like every other definer function here', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, extensions');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.notify_client_of_message() FROM PUBLIC, anon, authenticated;');
  });

  it('ships with a rollback', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_notify_client_of_message');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.notify_client_of_message();');
  });
});
