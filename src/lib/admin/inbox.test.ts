import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * 06 §18 — the Inbox, and the delivery layer beneath it.
 *
 * Two things are being pinned. First, that the Inbox is person-scoped: a thread whose
 * `project_id` is NULL — which every inbound WhatsApp conversation is until somebody
 * links a project — must be listable, selectable and readable here. Second, that the
 * UI does not know who carries a message: it asks for delivery, and the provider is
 * chosen server-side from the channel. Replacing GoHighLevel must not touch this screen.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const PAGE = 'src/app/routes/admin/inbox.tsx';
const THREAD = 'src/components/admin/conversations/ConversationThread.tsx';
const DELIVER = 'api/_handlers/conversation-deliver.ts';
const LIB = 'src/lib/supabase/conversations.ts';

describe('the Inbox needs no project', () => {
  const p = code(PAGE);

  it('lists every conversation — unfiltered by project — and never reads a workspace', () => {
    expect(p).toContain('listConversations()');
    expect(p).not.toMatch(/listConversations\(\{|loadWorkspace|LoadedWorkspace|\bws\./);
  });

  it('selects a thread by conversation id, from the URL, and the URL keeps it', () => {
    expect(p).toContain("params.get('conversation')");
    expect(p).toContain("next.set('conversation', c.id)");
    expect(p).toContain('shown.find(c => c.id === selectedId) ?? shown[0] ?? null');
    expect(p).toContain('<ConversationThread');
    expect(p).toContain('conversation={selected}');
  });

  it('a project link is offered only when the thread has one — never required to read the thread', () => {
    expect(p).toContain('{selected.projectId && (');
    expect(p).toContain('to={`/admin/projects/${selected.projectId}?tab=conversations&conversation=${selected.id}`}');
    // The thread renders before that link and does not depend on it.
    expect(p.indexOf('<ConversationThread')).toBeLessThan(p.indexOf('{selected.projectId && ('));
  });

  it('reads ?status=active, the parameter the Overview KPI sends', () => {
    expect(p).toContain("params.get('status')");
    expect(p).toContain("statusFilter === 'active' ? c.status !== 'resolved'");
  });

  it('is reachable: a route, a sidebar item, and no longer a placeholder', () => {
    expect(src('src/app/routes.ts')).toContain('route("admin/inbox",            "routes/admin/inbox.tsx")');
    const nav = src('src/components/shell/nav-config.ts');
    expect(nav).toContain("{ to: '/admin/inbox',");
    // The WhatsApp entry is this page, one channel of it — not a placeholder either.
    expect(nav).toContain("{ to: '/admin/inbox?channel=whatsapp',");
    expect(nav).not.toMatch(/'(inbox|whatsapp)':\s*\{\s*labelKey/);
    expect(code(PAGE)).toContain("params.get('channel')");
  });

  it('shows unavailable, error, loading and empty as different things', () => {
    for (const k of ['unavailable', 'error', 'loading', 'empty', 'emptyBody', 'selectPrompt', 'unknownPerson', 'notDelivered']) {
      const e = lookup(en, `admin.inbox.${k}`), f = lookup(fr, `admin.inbox.${k}`);
      expect(e, k).toBeTypeOf('string');
      expect(f, k).toBeTypeOf('string');
      expect(e, `${k} is not translated`).not.toBe(f);
    }
    expect(p).toContain("t('admin.inbox.unavailable')");
    expect(p).toContain("t('admin.inbox.error'");
    expect(p).toContain("t('admin.inbox.empty')");
  });

  it('renders no raw id and keeps a person\'s name out of the uuid', () => {
    expect(p).not.toMatch(/(?<!key=)\{c\.(id|personId)\}/);
    expect(p).toContain("personName(c.personId) || c.subject || t('admin.inbox.unknownPerson')");
  });
});

describe('the thread is one component, shared', () => {
  it('the workspace tab renders the same ConversationThread — not a copy', () => {
    const tab = code('src/components/admin/workspace/ConversationsTab.tsx');
    expect(tab).toContain('<ConversationThread');
    expect(tab).not.toContain('function Thread(');
    expect(code(PAGE)).toContain('<ConversationThread');
  });

  it('messages are chronological, by the reader, and direction is rendered as stored', () => {
    const th = code(THREAD);
    expect(th).toContain('listConversationMessages(conversation.id)');
    expect(th).not.toContain('.sort(');
    expect(th).toContain("m.direction === 'internal'");
    expect(th).toContain("m.direction === 'outbound'");
  });

  it('realtime is optional: an Inbox thread with no project simply does not subscribe', () => {
    const th = code(THREAD);
    expect(th).toContain('if (!realtimeProjectId) return;');
    expect(th).toContain('subscribeToMessages(realtimeProjectId, () => { load(); })');
  });

  it('Record Decision appears only where a decision has a project to belong to', () => {
    const th = code(THREAD);
    expect(th).toContain('{decision && (');
    expect(th).toContain('{recording && decision && (');
    expect(code(PAGE)).not.toContain('decision={');
  });
});

describe('delivery: the UI does not know who carries a message', () => {
  const th = code(THREAD), lib = code(LIB), h = code(DELIVER);

  it('the composer asks for delivery by channel — it never names a provider', () => {
    expect(th).toContain('await deliverMessage(messageId)');
    expect(th).not.toMatch(/ghl|GHL|whatsapp'/i);
    expect(th).toContain("conversation.channel !== 'jalla'");
    expect(lib).toContain("fetch('/api/events?action=conversation-deliver'");
    expect(lib).not.toMatch(/deliverWhatsApp|action=conversation-whatsapp/);
  });

  it('the provider is chosen server-side, from the channel, in one table', () => {
    expect(h).toContain("const PROVIDER_FOR: Record<string, 'ghl' | null> = { whatsapp: 'ghl', email: null, call: null, jalla: null };");
    expect(h).toContain("res.status(200).json({ ok: false, reason: 'not_deliverable', channel: conversation.channel });");
  });

  it('an internal note is NEVER delivered', () => {
    expect(h).toContain("if (message.direction !== 'outbound') {");
    expect(h).toContain("reason: 'not_outbound'");
    expect(h.indexOf("reason: 'not_outbound'")).toBeLessThan(h.indexOf('sendWhatsAppMessage('));
    // And the composer only asks for delivery on the outbound branch.
    expect(th).toContain("if (direction === 'outbound' && conversation.channel !== 'jalla') {");
  });

  it('WhatsApp is sent as WhatsApp — not as a conversation-provider Custom message', () => {
    const client = code('api/ghl/_client.ts');
    const fn = client.slice(client.indexOf('export async function sendWhatsAppMessage('), client.indexOf('export async function addConversationMessage('));
    expect(fn).toContain("type: 'WhatsApp'");
    expect(fn).not.toContain('conversationProviderId');
    expect(fn).toContain('verboseErrors: true');
  });

  it('the provider message id is persisted, and that is what makes a retry a no-op', () => {
    expect(h).toContain('ghl_message_id: ghlMessageId, ghl_synced_at:');
    expect(h).toContain('if (message.ghl_message_id) {');
    expect(h).toContain('alreadyDelivered: true');
    expect(h.indexOf('if (message.ghl_message_id) {')).toBeLessThan(h.indexOf('sendWhatsAppMessage('));
  });

  it('a refusal is never dressed up as delivery: the row is marked failed and the screen says so', () => {
    expect(h).toContain("await svc.from('project_messages').update({ status: 'failed' }).eq('id', messageId);");
    expect(h).toContain("reason: 'provider_rejected'");
    expect(h).not.toMatch(/ok: true[^}]*reason: 'provider_rejected'/);
    expect(th).toContain("setDelivery(d.detail ? `${t('admin.inbox.notDelivered')} — ${d.detail}` : t('admin.inbox.notDelivered'));");
    expect(lib).toContain('return { ok: body?.ok === true, reason: body?.reason');
  });

  it('is admin-only, on the caller\'s own token, before anything is sent', () => {
    expect(h).toContain("asCaller.rpc('is_admin')");
    expect(h).toContain("res.status(403).json({ error: 'Admins only' });");
    expect(h.indexOf("asCaller.rpc('is_admin')")).toBeLessThan(h.indexOf("from('project_messages')"));
  });

  it('is an events.ts action — no new serverless function', () => {
    expect(src('api/events.ts')).toContain("'conversation-deliver': conversationDeliver,");
  });
});
