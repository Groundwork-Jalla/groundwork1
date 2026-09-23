import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { personLabel, projectContext } from './inbox-context';
import type { InboxProject } from '@/lib/supabase/inbox-context';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * 06 §19 — Inbox usability: who the person is, what was last said, what needs a reply,
 * and what Groundwork is building for them.
 *
 * The rule under all of it: a project the CONVERSATION names is a fact; a project the
 * PERSON owns is context. The second is shown, labelled as such, and never written.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const PAGE = 'src/app/routes/admin/inbox.tsx';

const project = (id: string, name: string): InboxProject =>
  ({ id, name, status: 'active', tier: 'self_verify', currentStage: 3, country: 'CM', city: 'Douala' });
const owned = (personId: string, ...ps: InboxProject[]) => new Map([[personId, ps]]);

describe('A. identity: a name, then an address, never a phone number', () => {
  it('full name is primary and the email secondary', () => {
    expect(personLabel('Favour Nwachukwu', 'favour@tryjalla.com', 'Unknown')).toEqual({ primary: 'Favour Nwachukwu', secondary: 'favour@tryjalla.com' });
  });
  it('an empty or blank name falls back to the email, with nothing secondary', () => {
    expect(personLabel('', 'favour@tryjalla.com', 'Unknown')).toEqual({ primary: 'favour@tryjalla.com', secondary: null });
    expect(personLabel('   ', 'favour@tryjalla.com', 'Unknown')).toEqual({ primary: 'favour@tryjalla.com', secondary: null });
    expect(personLabel(null, 'favour@tryjalla.com', 'Unknown')).toEqual({ primary: 'favour@tryjalla.com', secondary: null });
  });
  it('neither name nor email falls back to the honest label, never to an id or a number', () => {
    expect(personLabel(null, null, 'Unidentified sender')).toEqual({ primary: 'Unidentified sender', secondary: null });
    expect(personLabel('', '', 'Unidentified sender').primary).toBe('Unidentified sender');
  });
  it('the page resolves labels through it, and no phone number is ever a display name', () => {
    const p = code(PAGE);
    expect(p).toContain('personLabel(p?.fullName, p?.email');
    expect(p).toContain('const staffName = useCallback((id: string | null) => (id ? label(id).primary');
    // No transport address is ever read for a label: the page never touches a phone
    // field, and the only names it renders come from personLabel / sender_name.
    expect(p).not.toMatch(/\bphone\b|\.from\b|\bto:\s/);
  });
});

describe('B. previews: the last message, and what kind it was', () => {
  it('one read for every thread, newest first, first row per conversation wins', () => {
    const lib = code('src/lib/supabase/conversations.ts');
    const fn = lib.slice(lib.indexOf('export async function listConversationPreviews'), lib.indexOf('export async function assignConversation'));
    expect(fn).toContain(".in('conversation_id', conversationIds)");
    expect(fn).toContain("order('created_at', { ascending: false })");
    expect(fn).toContain('if (!id || out.has(id)) continue;');
    expect(fn).toContain('if (conversationIds.length === 0) return');   // an empty list is not a query
  });
  it('the page loads previews alongside the list — not one read per row', () => {
    const p = code(PAGE);
    expect(p).toContain('listConversationPreviews(r.rows.map(c => c.id))');
    expect(p).toContain('Promise.all([');
    expect(p).not.toMatch(/rows\.map\([^)]*listConversationMessages/);
  });
  it('an internal note is marked as one; a staff reply is marked as ours', () => {
    const p = code(PAGE);
    expect(p).toContain("preview(c.id)!.direction === 'internal'");
    expect(p).toContain("t('admin.workspace.conversations.internal')");
    expect(p).toContain("preview(c.id)!.direction === 'outbound'");
    expect(p).toContain("t('admin.inbox.youPrefix')");
  });
  it('the row still carries its time, channel and status', () => {
    const p = code(PAGE);
    expect(p).toContain('formatRelative(c.lastMessageAt)');
    expect(p).toContain('admin.workspace.conversations.channel.${c.channel}');
    expect(p).toContain('admin.workspace.conversations.status.${c.status}');
  });
});

describe('C. needs reply: waiting_on_us, and no second source of truth', () => {
  const p = code(PAGE);
  it('the count is waiting_on_us; waiting_on_them never counts', () => {
    expect(p).toContain("(rows ?? []).filter(c => c.status === 'waiting_on_us').length");
    expect(p).not.toContain("'waiting_on_them'");
  });
  it('the chip filters through the existing ?status= model', () => {
    expect(p).toContain("setStatus(needsReplyOn ? null : 'waiting_on_us')");
    expect(p).toContain("next.set('status', value)");
    expect(p).toContain("next.delete('conversation')");     // a filter must not keep a hidden selection
  });
  it('no unread state is invented — no conversation_reads, no last_read_at', () => {
    expect(p).not.toMatch(/conversation_reads|last_read_at|unread/i);
    expect(code('src/lib/supabase/inbox-context.ts')).not.toMatch(/conversation_reads|last_read_at/);
  });
});

describe('D. project context: stated, never guessed, never written', () => {
  it('an explicitly linked project is the conversation\'s project', () => {
    const c = projectContext({ projectId: 'p1', personId: 'u1' }, owned('u1', project('p1', 'House of Lux')));
    expect(c).toMatchObject({ kind: 'linked', project: { name: 'House of Lux' } });
  });
  it('no link and exactly one project: the ACCOUNT\'s project, distinguishable from a linked one', () => {
    const c = projectContext({ projectId: null, personId: 'u1' }, owned('u1', project('p1', 'House of Lux')));
    expect(c.kind).toBe('account');
    expect(c.project?.id).toBe('p1');
  });
  it('no link and several projects: all of them, and no choice made', () => {
    const c = projectContext({ projectId: null, personId: 'u1' }, owned('u1', project('p1', 'House of Lux'), project('p2', 'Belle Famille')));
    expect(c.kind).toBe('choice');
    expect(c.project).toBeNull();
    expect(c.projects.map(p => p.name)).toEqual(['House of Lux', 'Belle Famille']);
  });
  it('a person with no project, and a conversation with no person, both say so', () => {
    expect(projectContext({ projectId: null, personId: 'u1' }, new Map())).toMatchObject({ kind: 'none', project: null, projects: [] });
    expect(projectContext({ projectId: null, personId: null }, owned('u1', project('p1', 'x')))).toMatchObject({ kind: 'none' });
  });
  it('projects come from the conversation\'s person — never from another account', () => {
    const c = projectContext({ projectId: null, personId: 'u2' }, owned('u1', project('p1', 'Someone else\'s')));
    expect(c.kind).toBe('none');
    const lib = code('src/lib/supabase/inbox-context.ts');
    expect(lib).toContain(".in('user_id', ids)");
    expect(lib).toContain("neq('status', 'archived')");
  });
  it('INFERENCE NEVER WRITES: nothing in the Inbox sets conversations.project_id', () => {
    for (const f of [PAGE, 'src/lib/admin/inbox-context.ts', 'src/lib/supabase/inbox-context.ts']) {
      const c = code(f);
      expect(c, f).not.toMatch(/linkConversation|project_id:\s|\.update\(|\.insert\(|\.rpc\(/);
    }
  });
  it('Open project goes to that project\'s workspace, and only a LINKED thread deep-links to the thread there', () => {
    const p = code(PAGE);
    expect(p).toContain('to={`/admin/projects/${context.project.id}${conversation.projectId ? `?tab=conversations&conversation=${conversation.id}` : \'\'}`}');
    expect(p).toContain('to={`/admin/projects/${p.id}`}');   // one of several: just the project
  });
  it('the list stays compact: a project name only when the thread is explicitly linked', () => {
    const p = code(PAGE);
    expect(p).toContain('{c.projectId && projectName(c.projectId, c.personId)');
    expect(p).not.toMatch(/context\.projects\.map[\s\S]{0,200}<li key=\{c\.id\}/);
  });
  it('a pre-project conversation is never hidden or refused', () => {
    const p = code(PAGE);
    expect(p).not.toMatch(/filter\([^)]*projectId/);
    expect(p).toContain("t('admin.inbox.noProject')");
  });
  it('every new string exists in both dictionaries and is translated', () => {
    for (const k of ['needsReply', 'youPrefix', 'projectLinked', 'projectAccount', 'accountProjects', 'notLinked', 'noProject', 'stage']) {
      const e = lookup(en, `admin.inbox.${k}`), f = lookup(fr, `admin.inbox.${k}`);
      expect(e, k).toBeTypeOf('string');
      expect(f, k).toBeTypeOf('string');
      expect(e, `${k} is not translated`).not.toBe(f);
    }
  });
});

/**
 * 06 §20 — the Overview knows who is waiting.
 *
 * One truth, `conversations.status = 'waiting_on_us'`, counted by the Overview, banded by
 * the database for the Action Center, and filtered by the Inbox. No second definition of
 * "needs attention", no read state, and nothing written from the Overview.
 */
describe('Overview integration', () => {
  const overview = code('src/lib/supabase/admin-overview.ts');
  const page = code('src/app/routes/admin/index.tsx');
  const centre = code('src/lib/admin/action-center.ts');
  const loader = code('src/lib/supabase/action-center.ts');
  const list = code('src/components/admin/overview/AttentionList.tsx');

  it('the KPI counts waiting_on_us — not "not resolved", not an invention', () => {
    expect(overview).toContain("select('id', { count: 'exact', head: true }).eq('status', 'waiting_on_us')");
    expect(page).toContain('value={data ? data.needsReply : null}');
    expect(page).toContain('labelKey="admin.kpiRow.needsReply"');
  });

  it('unavailable, error and zero stay different things', () => {
    // A missing 091 is null (the card shows "not available"); a real zero is 0.
    expect(overview).toContain("needsReplyRes.status === 'fulfilled' && !needsReplyRes.value.error ? (needsReplyRes.value.count ?? 0) : null");
  });

  it('the KPI opens exactly the conversations it counted', () => {
    expect(src('src/lib/admin/overview-links.ts')).toContain("conversations:  '/admin/inbox?status=waiting_on_us'");
    expect(code('src/app/routes/admin/inbox.tsx')).toContain("params.get('status')");
  });

  it('attention rows carry the person, the channel and what was said, and open the thread', () => {
    expect(centre).toContain('to: `/admin/inbox?status=waiting_on_us&conversation=${w.conversationId}`');
    expect(list).toContain('{item.preview && <span');
    expect(list).toContain("item.channel && t(`admin.workspace.conversations.channel.${item.channel}` as TKey)");
  });

  it('an internal note is never offered as the thing the client is waiting on', () => {
    expect(loader).toContain("previews.get(w.conversationId)?.direction === 'internal' ? undefined : previews.get(w.conversationId)?.content");
  });

  it('the extra reads are bounded by the waiting list and skipped when it is empty', () => {
    expect(loader).toContain('waitingIds.length === 0');
    expect(loader).toContain('listConversationPreviews(waitingIds)');
  });

  it('the Overview never infers a project for a conversation, and never writes', () => {
    expect(centre).toContain('const project = w.projectId ? projectById.get(w.projectId) : undefined;');
    for (const f of ['src/lib/supabase/admin-overview.ts', 'src/lib/supabase/action-center.ts', 'src/components/admin/overview/AttentionList.tsx', 'src/app/routes/admin/index.tsx']) {
      expect(code(f), f).not.toMatch(/\.update\(|\.insert\(|sendConversationMessage|resolveConversation|assignConversation|linkConversation/);
    }
  });

  it('no unread state was invented on the Overview either', () => {
    for (const f of [overview, loader, list, page]) expect(f).not.toMatch(/conversation_reads|last_read_at|unread/i);
  });

  it('both dictionaries carry the KPI strings, translated', () => {
    for (const k of ['needsReply', 'needsReplySub']) {
      const e = lookup(en, `admin.kpiRow.${k}`), f = lookup(fr, `admin.kpiRow.${k}`);
      expect(e, k).toBeTypeOf('string');
      expect(f, k).toBeTypeOf('string');
      expect(e, `${k} is not translated`).not.toBe(f);
    }
  });
});
