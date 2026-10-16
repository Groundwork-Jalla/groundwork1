import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Knowing who is speaking in a project thread.
 *
 * A project thread is a group chat: the client, the general contractor and a verifier of
 * each discipline all write into the same one, and the bubble showed `sender_name` alone.
 * A name does not say whether what follows is progress being reported, a stage being
 * signed off, or Jalla asking for a decision — and on a building site, acting on the
 * wrong one of those costs real money.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const thread   = read('src/components/admin/conversations/ConversationThread.tsx');
const project  = read('src/components/project/ProjectConversations.tsx');
const convLib  = read('src/lib/supabase/conversations.ts');

describe('the role is shown next to the name', () => {
  it('in the member bubble and the staff bubble alike', () => {
    // Two render sites: the member's bubble and the staff one. Both, or a client sees
    // the role and the person answering them does not.
    const shown = thread.match(/senderRole\(m\.senderId\) && /g) ?? [];
    expect(shown.length).toBe(2);
  });

  it('and is absent rather than blank when there is no role to show', () => {
    // A one-to-one WhatsApp chat has two people in it; tagging every line there is noise.
    expect(thread).toMatch(/if \(!roleOf\) return null;/);
    expect(thread).toMatch(/senderRole\(m\.senderId\) && /);
  });

  it('anyone who is not a participant is named as Jalla, not left unlabelled', () => {
    // "Somebody unlabelled" is exactly the ambiguity the label exists to remove.
    expect(thread).toMatch(/roleOf\(senderId\) \?\? 'staff'/);
  });
});

describe('the roles come from the one place that defines them', () => {
  it('project_participants — the same set that gets the bell and the email', () => {
    expect(convLib).toMatch(/rpc\('project_participants'/);
  });

  it('and a failure to load them costs the labels, never the conversation', () => {
    expect(convLib).toMatch(/if \(error\) return \{\};/);
    // Loaded in its own effect, so it cannot take the threads down with it.
    expect(project).toMatch(/useEffect\(\(\) => \{ void listProjectRoles\(projectId\)/);
  });

  it('only the project thread is labelled', () => {
    expect(project).toMatch(/roleOf=\{conversation\.projectId \? /);
  });
});

describe('every role has wording in both languages', () => {
  it.each(['owner', 'contractor', 'verifier', 'staff'])('%s', (role) => {
    const e = (en as any).project.chat.role[role];
    const f = (fr as any).project.chat.role[role];
    expect(typeof e).toBe('string');
    expect(e.length).toBeGreaterThan(0);
    expect(typeof f).toBe('string');
    expect(f.length).toBeGreaterThan(0);
  });

  it('and French is actually translated where the word differs', () => {
    expect((fr as any).project.chat.role.contractor).toBe('Entrepreneur');
    expect((fr as any).project.chat.role.verifier).toBe('Vérificateur');
  });

  it('the same four roles the phone message uses', () => {
    // The label a client reads in the app and the one on their WhatsApp must agree;
    // two vocabularies for one role is worse than none.
    const body = read('src/lib/admin/whatsapp-body.ts');
    for (const role of ['owner', 'contractor', 'verifier', 'staff']) {
      expect(body).toContain(`${role}:`);
    }
  });
});
