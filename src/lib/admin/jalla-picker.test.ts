import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchesProject, matchesAccount, canMessage, canMessageAccount, jallaHref } from './jalla-picker';
import type { JallaAccount, JallaProject } from '@/lib/supabase/jalla-projects';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Slice B is a convenience entry point over messaging Groundwork already has. So the
 * pins are mostly about what it must NOT become: a second message store, a second way to
 * pair a project with a client, or a provider dependency on the one native channel.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const modal  = code('src/components/admin/NewJallaMessage.tsx');
const loader = code('src/lib/supabase/jalla-projects.ts');
const inbox  = code('src/app/routes/admin/inbox.tsx');
const header = code('src/components/admin/workspace/WorkspaceHeader.tsx');
const migration = src('supabase/migrations/091_conversations.sql');

const proj = (o: Partial<JallaProject> = {}): JallaProject => ({
  id: 'j1', name: 'House of Lux', status: 'active', city: 'Douala', country: 'CM',
  currentStage: 3, ownerId: 'mary', ownerName: 'Mary Smith', ownerEmail: 'mary@example.cm', ...o,
});

const acct = (o: Partial<JallaAccount> = {}): JallaAccount => ({
  id: 'mary', name: 'Mary Smith', email: 'mary@example.cm', projects: [proj()], ...o,
});

describe('account first, then project — but the project still decides', () => {
  it('the account step narrows the list; it never reaches the RPC', () => {
    // Only a project id is ever sent, so choosing an account cannot pair a project with
    // the wrong person — the person is not an argument.
    expect(modal).toContain('ensureProjectConversation(project.id)');
    expect(modal).toContain('setAccount(a)');
    expect(modal).not.toMatch(/ensureProjectConversation\([^)]*account/);
  });

  it('an account with no project is shown, disabled, and told why', () => {
    expect(canMessageAccount(acct())).toBe(true);
    expect(canMessageAccount(acct({ projects: [] }))).toBe(false);
    expect(canMessageAccount(acct({ projects: [proj({ ownerId: null })] }))).toBe(false);
    expect(modal).toContain('noProjectsForAccount');
    // Hidden rows make a search look broken; a disabled row with a reason does not.
    expect(modal).toContain('disabled={!ok}');
  });

  it('typing a project name finds the account that owns it', () => {
    const a = acct({ name: 'Mary Smith', projects: [proj({ name: 'House of Lux' })] });
    expect(matchesAccount(a, 'house')).toBe(true);
    expect(matchesAccount(a, 'mary')).toBe(true);
    expect(matchesAccount(a, 'mary@example')).toBe(true);
    expect(matchesAccount(a, 'yaounde')).toBe(false);
    expect(matchesAccount(a, '')).toBe(true);
  });

  it('going back to the account list clears the pick', () => {
    expect(modal).toContain('function back() { setAccount(null); setPicked(null); }');
  });

  it('accounts that can be messaged sort first', () => {
    expect(loader).toContain('Number(b.projects.length > 0) - Number(a.projects.length > 0)');
  });

  it('an owner the account list cannot name still appears, from the project', () => {
    expect(loader).toContain('if (accounts.has(ownerId)) continue;');
    expect(loader).toContain('name: owned[0]?.ownerName ?? null');
  });
});

describe('the project determines the client — it is not a second choice', () => {
  it('the database reads the owner off the project', () => {
    // project_conversation(): INSERT ... SELECT user_id, id, 'jalla' FROM projects
    expect(migration).toMatch(/INSERT INTO public\.conversations \(person_id, project_id, channel\)\s*\n\s*SELECT user_id, id, 'jalla' FROM public\.projects WHERE id = p_project/);
  });

  it('the modal never sends a client, only a project', () => {
    expect(modal).toContain('ensureProjectConversation(project.id)');
    for (const banned of ['personId', 'person_id', 'ownerId:', 'clientId', 'setClient']) {
      expect(modal, `${banned} would make the client an input`).not.toContain(banned);
    }
  });

  it('a project with no client cannot be messaged', () => {
    expect(canMessage(proj())).toBe(true);
    expect(canMessage(proj({ ownerId: null }))).toBe(false);
    expect(modal).toContain('canMessage(p)');
    expect(modal).toContain('disabled={!ok}');
    expect(modal).toContain('noOwner');
  });

  it('an unreadable account still leaves a messageable project', () => {
    // The name comes from a separate lookup; losing it must not hide the project.
    const p = proj({ ownerName: null, ownerEmail: null });
    expect(canMessage(p)).toBe(true);
    expect(modal).toContain('ownerUnknown');
    expect(loader).toContain('.catch(() => new Map<string, { name: string; email: string }>())');
  });
});

describe('one thread per project, reused not recreated', () => {
  it('start and open are the same call', () => {
    expect(modal).toContain('ensureProjectConversation');
    expect(header).toContain('ensureProjectConversation(p.id)');
    // Nothing inserts a conversation from the browser.
    for (const banned of ["from('conversations')", '.insert(', '.upsert(']) {
      expect(modal, banned).not.toContain(banned);
      expect(header, banned).not.toContain(banned);
    }
  });

  it('the ensure function is race-safe, so no migration is needed', () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('conversation:project:'");
    // Locks, then re-checks, then inserts — the double-check is the point.
    const fn = migration.slice(migration.indexOf('FUNCTION public.project_conversation'));
    const body = fn.slice(0, fn.indexOf('END $$;'));
    expect(body.match(/SELECT id INTO v_id FROM public\.conversations/g)?.length).toBe(2);
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('INSERT INTO public.conversations'));
  });

  it('the canonical identity is project + jalla', () => {
    expect(migration).toContain("WHERE project_id = p_project AND channel = 'jalla'");
  });

  it('two projects of one client are two threads, deliberately', () => {
    // The lookup is keyed on the project, so A and B can never collapse into one.
    expect(migration).not.toMatch(/WHERE person_id = [^\n]*AND channel = 'jalla'/);
    expect(jallaHref('abc')).toBe('/admin/inbox?channel=jalla&conversation=abc');
  });
});

describe('search matches what a person would type', () => {
  it('project, client, email or place', () => {
    const p = proj();
    for (const q of ['house', 'MARY', 'mary@example', 'douala', 'cm', '']) {
      expect(matchesProject(p, q), q).toBe(true);
    }
    expect(matchesProject(p, 'yaounde')).toBe(false);
  });

  it('a project with no owner name is still findable by its own name', () => {
    expect(matchesProject(proj({ ownerName: null, ownerEmail: null }), 'house')).toBe(true);
  });
});

describe('a thread created just now is visible immediately', () => {
  it('the Inbox re-reads before the navigation lands', () => {
    // Without this the URL names a real conversation and the page renders the empty
    // state — "no conversation yet" about a conversation that exists.
    expect(modal).toContain('await onCreated?.()');
    expect(modal.indexOf('await onCreated?.()')).toBeLessThan(modal.indexOf('navigate(jallaHref(id))'));
    expect(inbox).toContain('onCreated={load}');
  });

  it('the workspace re-reads before opening its Conversations tab', () => {
    expect(header).toContain('await onReload?.()');
    expect(header.indexOf('await onReload?.()')).toBeLessThan(header.indexOf('navigate(workspaceHref'));
    expect(code('src/app/routes/admin/projects.detail.tsx')).toContain('onReload={reload}');
  });

  it('an unknown conversation id re-reads once, and only once', () => {
    // Covers every other way a fresh thread can be deep-linked: the project buttons, the
    // support chooser, a colleague in another tab.
    expect(inbox).toContain('refetched.current.has(selectedId)');
    expect(inbox).toContain('refetched.current.add(selectedId)');
    // A bad id must not loop.
    expect(inbox).toMatch(/refetched\.current\.add\(selectedId\);\s*\n\s*void load\(\);/);
  });
});

describe('the entry points', () => {
  it('New message appears on the native channel and nowhere else', () => {
    expect(inbox).toContain("channelFilter === 'jalla'");
    expect(inbox).toContain('NewJallaMessage');
    expect(inbox).toContain('admin.jalla.newMessage');
  });

  it('inside a project there is no picker, and it does not leave the project', () => {
    // The Conversations tab already renders this thread. Sending the admin to the Inbox
    // would cost them the stage, budget and team they were looking at.
    expect(header).toContain("workspaceHref(p.id, { tab: 'conversations', conversationId: id })");
    expect(header).toContain('ensureProjectConversation(p.id)');
    expect(header).not.toContain('NewJallaMessage');
    expect(header).not.toContain('jallaHref');
  });

  it('both land on the same addressing the Inbox already reads', () => {
    expect(modal).toContain('jallaHref(id)');
    expect(inbox).toContain("'conversation'");
    expect(inbox).toContain("'channel'");
  });
});

describe('native means native — no provider anywhere near it', () => {
  it('no GHL, WhatsApp, phone or provider id in the new flow', () => {
    for (const banned of [
      'ghl', 'Ghl', 'GHL', 'whatsapp', 'WhatsApp', 'phone', 'Phone',
      'provider', 'Provider', 'conversation-deliver', 'deliverMessage',
    ]) {
      expect(modal, `${banned} is not part of native messaging`).not.toContain(banned);
      expect(loader, `${banned} is not part of native messaging`).not.toContain(banned);
    }
  });

  it('nothing is sent from the picker — the Inbox composer does that', () => {
    for (const banned of ['sendConversationMessage', 'send_message', 'internal']) {
      expect(modal, `${banned} does not belong in a project picker`).not.toContain(banned);
    }
  });

  it('internal notes stay staff-only, as 091 already enforces', () => {
    // The client read policy excludes them at the database, not in the UI.
    expect(migration).toContain("USING (direction <> 'internal' AND (");
    expect(migration).toContain("WITH CHECK (auth.uid() = sender_id AND direction <> 'internal'");
  });
});

describe('honest states', () => {
  it('unreadable, empty and no-match are three different answers', () => {
    expect(modal).toContain('state === null || !state.available');
    expect(modal).toContain('admin.jalla.unavailable');
    expect(modal).toContain('admin.jalla.noAccounts');
    expect(modal).toContain('admin.jalla.noMatch');
  });

  it('a missing projects table is reported, not treated as none', () => {
    expect(loader).toContain('isMissingTable(error)');
    expect(loader).toContain('available: false');
  });
});

describe('EN and FR parity', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.jalla.newMessage', 'admin.jalla.newTitle', 'admin.jalla.newSub', 'admin.jalla.search',
      'admin.jalla.start', 'admin.jalla.message', 'admin.jalla.noOwner', 'admin.jalla.ownerUnknown',
      'admin.jalla.noProjects', 'admin.jalla.noMatch', 'admin.jalla.unavailable', 'admin.jalla.confirm',
      'admin.jalla.pickProject', 'admin.jalla.searchProjects', 'admin.jalla.projectCount',
      'admin.jalla.noProjectsForAccount', 'admin.jalla.noAccounts',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
