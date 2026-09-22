import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkspaceParams, workspaceHref } from './workspace-params';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step 5b.3 — the project-scoped Conversations tab and the Record Decision dialog.
 *
 * Production has no conversation, so the populated path is pinned here as source: the
 * threads are `ws.conversations`, the messages are `listConversationMessages(id)` in
 * thread order with direction rendered as stored, the two composer acts are two
 * different RPC directions, assign/resolve are 091's, a decision is written once and
 * read back from the model — and none of it is the Inbox.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const TAB = 'src/components/admin/workspace/ConversationsTab.tsx';
const MODAL = 'src/components/admin/conversations/RecordDecisionModal.tsx';
// The thread itself is shared with the Inbox (06 §18) — same component, so the two
// surfaces cannot drift. The tab renders it; these pins follow it to where it lives.
const THREAD = 'src/components/admin/conversations/ConversationThread.tsx';

describe('project scope — this is not the Inbox', () => {
  it('threads are ws.conversations; there is no discovery, no channel queue, no cross-project read', () => {
    const c = code(TAB);
    expect(c).toContain('ws.conversations.map(');
    expect(c).not.toMatch(/listConversations\(|supabase\.from\(|\.rpc\(/);
    expect(c).not.toMatch(/channel\s*===|filter\(c => c\.channel|status\s*===\s*'open'\s*&&/);   // no channel/status queues
    expect(c).not.toMatch(/\/admin\/inbox|\/admin\/whatsapp|\/admin\/email|\/admin\/calls/);
  });

  it('messages come from the thread reader, in the order it returns them, direction as stored', () => {
    const c = code(THREAD);
    expect(c).toContain('listConversationMessages(conversation.id)');
    expect(c).not.toContain('.sort(');
    expect(c).not.toContain('fetchMessages(');
    // Three renderings keyed on the stored direction, and only that.
    expect(c).toContain("m.direction === 'internal'");
    expect(c).toContain("m.direction === 'outbound'");
    expect(c).not.toMatch(/sender_id\s*===|senderId\s*===\s*(user|owner)/);   // never "was it the owner"
  });

  it('deep link: ?tab=conversations&conversation=<id> selects the thread; a foreign id falls back to the first', () => {
    expect(parseWorkspaceParams(new URLSearchParams('tab=conversations&conversation=c1')).conversationId).toBe('c1');
    expect(workspaceHref('p', { tab: 'conversations', conversationId: 'c1' })).toBe('/admin/projects/p?tab=conversations&conversation=c1');
    const c = code(TAB);
    expect(c).toContain("ws.conversations.find(c => c.id === conversationId)) || ws.conversations[0] || null");
    expect(c).toContain("workspaceHref(ws.project.id, { tab: 'conversations', conversationId: c.id })");
    expect(code('src/app/routes/admin/projects.detail.tsx')).toContain('<ConversationsTab loaded={loaded} conversationId={conversationId} onChanged={reload} />');
  });
});

describe('acts are the 091 RPCs, and every success re-reads', () => {
  it('Send and Internal note are the same RPC with two explicit directions', () => {
    const c = code(THREAD);
    expect(c).toContain('sendConversationMessage(conversation.id, content, direction)');
    expect(c).toContain("send('outbound')");
    expect(c).toContain("send('internal')");
    expect(c).not.toMatch(/sendMessage\(/);   // the pre-091 path
  });

  it('Assign and Resolve call their functions; nobody is invented when the staff list is empty', () => {
    const c = code(THREAD) + code(TAB);
    expect(c).toContain('assignConversation(conversation.id, assignee || null)');
    expect(c).toContain('resolveConversation(conversation.id)');
    expect(c).toContain("u.roles.split(',').map(r => r.trim()).includes('admin')");
    expect(c).toContain("t('admin.workspace.conversations.noStaff')");
  });

  it('after any act the thread is re-read and the workspace reloaded; nothing is appended locally', () => {
    const c = code(THREAD);
    expect(c).toContain('await fn(); await load(); onChanged(); return true;');
    expect(c).not.toMatch(/setMessages\(\s*(prev|m|msgs)\s*=>/);   // no optimistic append
    // Realtime: a new row triggers a re-read, not a raw payload push.
    expect(c).toContain('subscribeToMessages(realtimeProjectId, () => { load(); })');
  });

  it('a refusal is shown as phrased and the draft survives it', () => {
    const c = code(THREAD);
    expect(c).toContain("msg.includes('empty_message')");
    expect(c).toContain(".then(ok => { if (ok) setDraft(''); })");
  });

  it('starting a thread is the existing ensure_project_conversation, offered only from the empty state', () => {
    const c = code(TAB);
    expect(c).toContain('ensureProjectConversation(ws.project.id)');
    expect(c.indexOf("state === 'empty'")).toBeLessThan(c.indexOf('startThread}'));
  });
});

describe('Record Decision', () => {
  it('writes once through record_decision with the eight RPC fields, and reads back from ws.decisions', () => {
    const m = code(MODAL);
    expect(m).toContain('recordDecision({');
    for (const f of ['projectId', 'subject', 'decision', 'related', 'relatedId', 'conversationId', 'messageId', 'costImpactUsd', 'scheduleImpactDays', 'approvedBy']) expect(m, f).toContain(f);
    expect(m).not.toMatch(/supabase\.from\(|\.rpc\(|\.insert\(/);
    const c = code(TAB);
    expect(c).toContain('ws.decisions.map(');
    expect(c).not.toMatch(/setDecisions|decisions\s*=\s*\[/);   // never local
    expect(code(THREAD)).toContain('onRecorded={() => { setRecording(false); setSource(null); onChanged(); }}');
  });

  it('"approved by the client" names only the owner and is off by default', () => {
    const m = code(MODAL);
    expect(m).toContain('approvedBy: approved && ownerId ? ownerId : undefined');
    expect(m).toContain('useState(false)');
    expect(m).toContain('disabled={!ownerId}');
  });

  it('a decision is distinct from a message: separate list, its own vocabulary, a traced source', () => {
    expect(lookup(en, 'admin.decision.body')).toMatch(/what the project will now do/i);
    expect(code(TAB)).toContain("t('admin.decision.listTitle')");
    expect(code(THREAD)).toContain('message={source ? { id: source.id, senderName: source.senderName, content: source.content } : null}');
  });
});

describe('empty, unavailable, error', () => {
  it('the tab and the thread each tell the three apart', () => {
    const c = code(TAB), th = code(THREAD);
    expect(c).toContain("state === 'unavailable' || state === 'error'");
    expect(c).toContain("state === 'empty'");
    expect(th).toContain('messages === null ? (');           // read failed
    expect(th).toContain('!available ? (');                   // 091 columns absent
    expect(th).toContain("t('admin.workspace.conversations.noMessages')");
  });
});

describe('both dictionaries, and no raw ids', () => {
  it('every conversation and decision string exists in en and fr and is translated', () => {
    for (const key of [
      'admin.workspace.conversations.empty', 'admin.workspace.conversations.emptyBody', 'admin.workspace.conversations.start',
      'admin.workspace.conversations.send', 'admin.workspace.conversations.internalNote', 'admin.workspace.conversations.internalHint',
      'admin.workspace.conversations.assign', 'admin.workspace.conversations.resolve', 'admin.workspace.conversations.noStaff',
      'admin.workspace.conversations.status.waiting_on_us', 'admin.workspace.conversations.status.resolved',
      'admin.workspace.conversations.channel.call',
      'admin.decision.title', 'admin.decision.body', 'admin.decision.record', 'admin.decision.listEmpty', 'admin.decision.approvedByClient',
      'admin.decision.relatedKind.stage', 'admin.decision.relatedKind.payment',
    ]) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} not translated`).not.toBe(f);
    }
    // A brand name is the same word in both languages.
    expect(lookup(fr, 'admin.workspace.conversations.channel.jalla')).toBe('Groundwork');
  });

  it('renders no raw id, and keeps light/dark paired with accents only', () => {
    for (const f of [TAB, MODAL, THREAD]) {
      const c = code(f);
      expect(c, f).not.toMatch(/\.slice\(0,\s*8\)/);
      expect(c, f).not.toMatch(/(?<![=$])\{(?:c|m|d)\.(?:id|senderId|assignedTo|recordedBy|approvedBy)\}/);
      const light = (src(f).match(/(?<!dark:)\bbg-white\b/g) ?? []).length;
      const dark  = (src(f).match(/dark:bg-\[#(?:1e1e1e|252525)\]/g) ?? []).length;
      expect(dark, `${f}: light surfaces without dark counterparts`).toBeGreaterThanOrEqual(light);
      expect(src(f), f).not.toMatch(/bg-(green|amber|red|yellow|emerald|rose|blue)-\d/);
    }
  });
});
