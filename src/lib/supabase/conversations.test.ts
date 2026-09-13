import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 091's behaviour was proven on a local Postgres with 084→091 applied over pre-091 chat
 * (owner, staff, contractor and GHL-delivered messages): every row survived byte-for-byte
 * and joined its project's thread with a direction derived from its author; the pre-091
 * client shape still inserts; a non-staff writer cannot smuggle `internal`; two first-
 * contact deliveries at once made one thread; two first messages on a threadless project
 * made one thread; the re-apply changed nothing. These pin the SHAPE.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql      = read('supabase/migrations/091_conversations.sql');
const ddl      = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const messages = read('src/lib/supabase/messages.ts');
const client   = read('src/lib/supabase/conversations.ts');

describe('extend, do not replace', () => {
  it('creates exactly conversations and decisions; project_messages and support_tickets are ALTERed', () => {
    const tables = ddl.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g) ?? [];
    expect(tables).toEqual(['CREATE TABLE IF NOT EXISTS public.conversations', 'CREATE TABLE IF NOT EXISTS public.decisions']);
    expect(ddl).toMatch(/ALTER TABLE public\.project_messages\s+ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public\.conversations\(id\)/);
    expect(ddl).toMatch(/ALTER TABLE public\.project_messages ALTER COLUMN project_id DROP NOT NULL/);
    expect(ddl).toMatch(/ALTER TABLE public\.support_tickets\s+ADD COLUMN IF NOT EXISTS project_id/);
  });
  it('no second activity table; every staff act audits through log_activity', () => {
    expect(ddl).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.(activit|timeline|event|message_log)/);
    for (const a of ['conversation.created', 'conversation.assigned', 'conversation.linked', 'conversation.resolved', 'decision.recorded', 'decision.approved', 'ticket.linked', 'message.internal_note'])
      expect(ddl).toContain(`'${a}'`);
    expect((ddl.match(/log_activity\(/g) ?? []).length).toBe(8);
  });
  it('no stored derived state: unanswered is a function over status + last_message_at, thresholds in app_config', () => {
    expect(ddl).not.toMatch(/unanswered\s+boolean|is_unanswered|overdue\s+boolean/);
    expect(ddl).toMatch(/INSERT INTO public\.app_config \(key, value\) VALUES\s+\('unanswered_conversation_hours', '4'\),\s+\('unanswered_bands', '\{"medium":4,"high":8,"critical":24\}'\)\s+ON CONFLICT \(key\) DO NOTHING/);
    expect(ddl).toMatch(/SELECT value INTO v_txt FROM public\.app_config WHERE key = 'unanswered_conversation_hours'/);
    expect(client).not.toMatch(/\b4\b.*hours|hours.*\b4\b/);
  });
});

describe('identity and idempotency', () => {
  it('ghl_conversation_id is the identity: UNIQUE where set', () => {
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS conversations_ghl_conversation_id_key\s+ON public\.conversations \(ghl_conversation_id\) WHERE ghl_conversation_id IS NOT NULL/);
  });
  it('the inbound resolver locks on the identity, resolves conv id → contact id → person, and creates ON CONFLICT DO NOTHING', () => {
    const fn = ddl.slice(ddl.indexOf('FUNCTION public.ensure_inbound_conversation'), ddl.indexOf('FUNCTION public.assign_conversation'));
    expect(fn).toMatch(/pg_advisory_xact_lock\(hashtext\('conversation:inbound:' \|\| v_key\)\)/);
    const a = fn.indexOf('WHERE ghl_conversation_id = p_ghl_conversation_id');
    const b = fn.indexOf('WHERE ghl_contact_id = p_ghl_contact_id');
    const c = fn.indexOf('WHERE person_id = p_person');
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
    expect(fn).toMatch(/ON CONFLICT \(ghl_conversation_id\) WHERE ghl_conversation_id IS NOT NULL DO NOTHING/);
    expect(fn).not.toMatch(/ghl_thread_project_id/);
  });
  it('inbound messages keep 085’s idempotency: the handler upserts on ghl_message_id, no other key', () => {
    const delivery = read('api/_handlers/conversation-delivery.ts');
    expect((delivery.match(/onConflict: 'ghl_message_id', ignoreDuplicates: true/g) ?? []).length).toBe(2); // 091 path + pre-091 fallback
  });
  it('a project gets one thread even under concurrent first messages (advisory lock in project_conversation)', () => {
    const fn = ddl.slice(ddl.indexOf('FUNCTION public.project_conversation'), ddl.indexOf('FUNCTION public.messages_default_conversation'));
    expect(fn).toMatch(/pg_advisory_xact_lock\(hashtext\('conversation:project:' \|\| p_project::text\)\)/);
  });
});

describe('direction and the internal note', () => {
  it('direction is derived from the author — origin ghl is outbound (staff wrote it in GHL), not inbound', () => {
    expect(ddl).toMatch(/WHEN m\.origin = 'ghl' THEN 'outbound'/);
    expect(ddl).toMatch(/r\.role = 'admin'\) THEN 'outbound'\s+ELSE 'inbound'/);
  });
  it('origin ghl is trusted only without a session (077’s pin runs after this trigger)', () => {
    expect(ddl).toMatch(/IF NEW\.origin = 'ghl' AND v_actor IS NULL THEN\s+NEW\.direction := 'outbound'/);
  });
  it('a non-staff session can never write internal — trigger, RPC and both policies say so', () => {
    expect(ddl).toMatch(/IF NEW\.direction = 'internal' AND v_actor IS NOT NULL AND NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'not_admin:/);
    expect(ddl).toMatch(/v_dir := 'inbound';/);
    expect(ddl).toMatch(/CREATE POLICY "member_read_messages" ON public\.project_messages FOR SELECT TO authenticated\s+USING \(direction <> 'internal' AND/);
    expect(ddl).toMatch(/CREATE POLICY "member_send_messages" ON public\.project_messages FOR INSERT TO authenticated\s+WITH CHECK \(auth\.uid\(\) = sender_id AND direction <> 'internal' AND/);
  });
  it('the thread moves with messages: inbound → waiting_on_us, outbound → waiting_on_them, internal moves nothing, resolved reopens', () => {
    expect(ddl).toMatch(/WHEN NEW\.direction = 'internal' THEN status\s+WHEN NEW\.direction = 'inbound'\s+THEN 'waiting_on_us'\s+ELSE 'waiting_on_them'/);
    expect(ddl).toMatch(/resolved_at = CASE WHEN NEW\.direction = 'internal' THEN resolved_at ELSE NULL END/);
  });
});

describe('RLS and grants', () => {
  it('conversations and decisions are SELECT-only from the browser; readers are admin, person, project member', () => {
    const policies = ddl.match(/CREATE POLICY "[^"]+"\s+ON public\.(conversations|decisions) FOR (\w+)/g) ?? [];
    expect(policies.length).toBe(5);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
    expect(ddl).toMatch(/"person_read_conversations" ON public\.conversations FOR SELECT TO authenticated USING \(person_id = auth\.uid\(\)\)/);
  });
  it('the old four message policies are replaced by two member policies; admin’s two (009) stay', () => {
    for (const p of ['owner_read_messages', 'contractors_read_invited_messages', 'owner_send_messages', 'contractors_send_invited_messages'])
      expect(ddl).toMatch(new RegExp(`DROP POLICY IF EXISTS "${p}"`));
    expect(ddl).not.toMatch(/admin_select_all_messages|admin_insert_messages/);
  });
  it('the inbound resolver is service_role only; staff acts re-check is_admin()', () => {
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.ensure_inbound_conversation\(uuid, text, text, text\)\s+FROM PUBLIC, anon, authenticated/);
    expect(ddl).toMatch(/GRANT EXECUTE ON FUNCTION public\.ensure_inbound_conversation\(uuid, text, text, text\)\s+TO service_role/);
    for (const f of ['assign_conversation', 'link_conversation', 'resolve_conversation', 'record_decision', 'link_ticket', 'unanswered_conversations']) {
      const body = ddl.slice(ddl.indexOf(`FUNCTION public.${f}(`));
      expect(body.slice(0, 900)).toMatch(/IF NOT public\.is_admin\(\) THEN RAISE EXCEPTION 'not_admin:/);
    }
  });
});

describe('decisions are a record', () => {
  it('immutable except approval, once; deletion refused; reversal names the old row', () => {
    expect(ddl).toMatch(/supersedes_id\s+uuid REFERENCES public\.decisions\(id\)/);
    expect(ddl).toMatch(/RAISE EXCEPTION 'immutable: a decision is a record; record a new one that supersedes it'/);
    expect(ddl).toMatch(/RAISE EXCEPTION 'immutable: an approval is a record'/);
    expect(ddl).toMatch(/RAISE EXCEPTION 'immutable: a decision is not deleted'/);
    expect(ddl).toMatch(/CHECK \(\(approved_by IS NULL\) = \(approved_at IS NULL\)\)/);
  });
});

describe('the app', () => {
  it('sendMessage goes through the thread and keeps the direct insert only as the not-yet-applied fallback', () => {
    expect(messages).toMatch(/const conversationId = await ensureProjectConversation\(projectId\);\s+messageId = await sendConversationMessage\(conversationId, content\);/);
    const rpcAt = messages.indexOf('ensureProjectConversation(projectId)');
    const insertAt = messages.indexOf(".from('project_messages')\n      .insert(");
    expect(insertAt).toBeGreaterThan(rpcAt);
    expect(messages.slice(rpcAt, insertAt)).toMatch(/if \(!isConversationsUnavailable\(err\)\) throw err;/);
  });
  it('the client module writes nothing directly', () => {
    expect(client).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    for (const f of ['send_message', 'ensure_project_conversation', 'assign_conversation', 'link_conversation', 'resolve_conversation', 'record_decision', 'confirm_decision', 'link_ticket', 'unanswered_conversations'])
      expect(client).toContain(`rpc('${f}'`);
  });
  it('no new serverless function: the two handlers changed are existing actions', () => {
    const events = read('api/events.ts');
    expect(events).toMatch(/crm-chat-mirror/);
    expect(events).toMatch(/crm-delivery/);
  });
});
