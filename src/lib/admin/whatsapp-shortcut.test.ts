import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWhatsAppThread, isDeliverablePhone, inboxHref, type WhatsAppRow } from './whatsapp-shortcut';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The product rule under test: ONE CLIENT = ONE WHATSAPP CHAT. The project is only where
 * the admin clicked, so the shortcut must never create a second thread, never re-point an
 * existing one, and never write conversations.project_id at all.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const server = code('api/_handlers/project-whatsapp.ts');
const client = code('src/lib/supabase/project-whatsapp.ts');
const header = code('src/components/admin/workspace/WorkspaceHeader.tsx');
const deliver = code('api/_handlers/conversation-deliver.ts');

const row = (o: Partial<WhatsAppRow> = {}): WhatsAppRow => ({
  id: 'c1', personId: 'mary', projectId: null, channel: 'whatsapp',
  ghlConversationId: null, ghlContactId: null,
  lastMessageAt: null, createdAt: '2026-01-01T00:00:00Z', ...o,
});

describe('one client, one chat', () => {
  it('the same person resolves to the same thread whichever project you came from', () => {
    // The resolver never sees a project id, which is the structural guarantee.
    const rows = [row({ id: 'W', projectId: 'A', ghlConversationId: 'ghl_1' })];
    expect(resolveWhatsAppThread(rows, 'mary')).toEqual({ kind: 'found', conversationId: 'W' });
    expect(resolveWhatsAppThread.length).toBe(2); // (rows, personId) — no project argument
  });

  it('a thread already linked to another project is opened, not blocked and not moved', () => {
    const rows = [row({ id: 'W', projectId: 'projectA', ghlConversationId: 'ghl_1' })];
    expect(resolveWhatsAppThread(rows, 'mary')).toEqual({ kind: 'found', conversationId: 'W' });
    // And the server never writes project_id, in either direction.
    expect(server).not.toMatch(/project_id\s*:/);
    expect(server).not.toContain('link_conversation');
  });

  it('another person\'s thread is never returned', () => {
    const rows = [row({ id: 'W', personId: 'someone-else', ghlConversationId: 'ghl_1' })];
    expect(resolveWhatsAppThread(rows, 'mary')).toEqual({ kind: 'none' });
  });

  it('a non-WhatsApp thread for the same person is not reused', () => {
    const rows = [row({ id: 'E', channel: 'email', ghlConversationId: 'ghl_1' })];
    expect(resolveWhatsAppThread(rows, 'mary')).toEqual({ kind: 'none' });
  });
});

describe('provider identity decides, never recency', () => {
  it('the row carrying the GHL thread wins over a local shell', () => {
    const rows = [
      row({ id: 'shell', createdAt: '2026-09-01T00:00:00Z', lastMessageAt: '2026-09-01T00:00:00Z' }),
      row({ id: 'real', ghlConversationId: 'ghl_1', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(resolveWhatsAppThread(rows, 'mary')).toEqual({ kind: 'found', conversationId: 'real' });
  });

  it('two different provider threads for one person is reported, not picked between', () => {
    const rows = [
      row({ id: 'a', ghlConversationId: 'ghl_1' }),
      row({ id: 'b', ghlConversationId: 'ghl_2', lastMessageAt: '2026-09-09T00:00:00Z' }),
    ];
    const got = resolveWhatsAppThread(rows, 'mary');
    expect(got.kind).toBe('ambiguous');
    if (got.kind === 'ambiguous') expect(got.conversationIds).toEqual(['a', 'b']);
  });

  it('several shells with no provider identity are ambiguous too — a third would not help', () => {
    expect(resolveWhatsAppThread([row({ id: 'a' }), row({ id: 'b' })], 'mary').kind).toBe('ambiguous');
    // One shell alone is unambiguous.
    expect(resolveWhatsAppThread([row({ id: 'a' })], 'mary')).toEqual({ kind: 'found', conversationId: 'a' });
  });

  it('the server creates nothing when the answer is ambiguous', () => {
    expect(server).toContain("reason: 'ambiguous'");
    expect(server.indexOf("reason: 'ambiguous'")).toBeLessThan(server.indexOf('ensureConversation('));
  });
});

describe('creation happens only when there is truly nothing, and only through the provider', () => {
  it('a reused thread short-circuits before any provider call', () => {
    expect(server.indexOf("created: false")).toBeLessThan(server.indexOf('upsertContact('));
    expect(server.indexOf("created: false")).toBeLessThan(server.indexOf('ensureConversation('));
  });

  it('no usable phone and no contact means nothing is created', () => {
    expect(server).toContain('isDeliverablePhone');
    expect(server).toContain("reason: 'no_phone'");
    expect(server.indexOf("reason: 'no_phone'")).toBeLessThan(server.indexOf('upsertContact('));
  });

  it('normalisePhone returning its input is not mistaken for a valid number', () => {
    // It hands back whatever it was given when it cannot place the number.
    expect(isDeliverablePhone('+237670000000')).toBe(true);
    for (const bad of ['670000000', 'not a number', '', null, undefined, '+12', '+1234567890123456', '+237 abc']) {
      expect(isDeliverablePhone(bad as string), String(bad)).toBe(false);
    }
    expect(server).toContain('normalisePhone(');
  });

  it('a provider that will not open a thread leaves no local row behind', () => {
    expect(server).toContain("reason: 'provider_failed'");
    expect(server.indexOf("reason: 'provider_failed'")).toBeLessThan(server.indexOf("from('conversations')\n    .insert("));
  });

  it('the new row carries person, channel and both provider ids', () => {
    expect(server).toMatch(/insert\(\{ person_id: personId, channel: 'whatsapp', ghl_contact_id: contactId, ghl_conversation_id: ghlConversationId \}\)/);
  });

  it('a unique collision reads back the owning row and overwrites nothing', () => {
    expect(server).toContain("eq('ghl_conversation_id', ghlConversationId)");
    expect(server).not.toMatch(/upsert\(|onConflict/);
  });
});

describe('the client is the project owner and nobody else', () => {
  it('resolved only through projects.user_id', () => {
    expect(server).toContain("from('projects').select('id, user_id')");
    expect(server).toContain('project.user_id');
    expect(server).toContain("eq('person_id', personId)");
  });

  it('no contractor or verifier contact can be reached from here', () => {
    for (const banned of ['contractor_invites', 'project_verifiers', 'contractors', 'verifier_profiles', 'full_name.ilike', 'ilike']) {
      expect(server, `${banned} is not how the client is found`).not.toContain(banned);
    }
  });

  it('the phone comes from the client\'s own profile row', () => {
    expect(server).toMatch(/from\('profiles'\)[\s\S]{0,120}eq\('id', personId\)/);
    expect(server).toContain('profile?.phone');
  });
});

describe('the provider is only ever reached from the server', () => {
  it('the browser calls the existing events boundary, not GHL', () => {
    expect(client).toContain('/api/events?action=project-whatsapp');
    for (const banned of ['leadconnector', 'services.leadconnectorhq', 'ghlFetch', 'upsertContact', 'ensureConversation', 'GHL_']) {
      expect(client, `${banned} must not be in the browser`).not.toContain(banned);
      expect(header, `${banned} must not be in the browser`).not.toContain(banned);
    }
  });

  it('admin is proved before the service-role client exists', () => {
    expect(server).toContain("rpc('is_admin')");
    expect(server).toContain('res.status(403)');
    expect(server.indexOf("rpc('is_admin')")).toBeLessThan(server.indexOf('createClient(url, serviceKey'));
  });

  it('it is routed through the existing action table, not a new function', () => {
    expect(src('api/events.ts')).toContain("'project-whatsapp'");
  });
});

describe('the redirect opens the exact thread in the existing Inbox', () => {
  it('addresses the conversation, not the channel list', () => {
    expect(inboxHref('abc')).toBe('/admin/inbox?channel=whatsapp&conversation=abc');
    expect(header).toContain('inboxHref(r.conversationId)');
    // The Inbox already reads both of these.
    const inbox = code('src/app/routes/admin/inbox.tsx');
    expect(inbox).toContain("'conversation'");
    expect(inbox).toContain("'channel'");
  });

  it('there is no second WhatsApp UI', () => {
    for (const banned of ['ConversationThread', 'composer', 'Composer', 'sendConversationMessage']) {
      expect(header, `${banned} would duplicate the Inbox`).not.toContain(banned);
    }
  });

  it('every refusal is named to the operator rather than failing silently', () => {
    expect(header).toContain('whatsappFail');
    for (const reason of ['no_client', 'no_phone', 'not_configured', 'contact_failed',
                          'provider_failed', 'record_failed', 'conversations_unavailable', 'ambiguous', 'error']) {
      expect(lookup(en, `admin.workspace.header.whatsappFail.${reason}`), reason).toBeTypeOf('string');
      expect(lookup(fr, `admin.workspace.header.whatsappFail.${reason}`), reason).toBeTypeOf('string');
    }
    // Navigation happens only on a real ok.
    expect(header).toMatch(/if \(r\.ok\) \{ navigate/);
  });
});

describe('a failed provider-thread write is no longer swallowed', () => {
  it('the update is checked, and a unique collision is called what it is', () => {
    expect(deliver).toContain('learnErr');
    expect(deliver).toContain("'23505'");
    expect(deliver).toContain('collision');
    expect(deliver).toContain('providerThread');
  });

  it('a collision is never resolved by overwriting the other conversation', () => {
    // Only this conversation's own row may be touched, and only while its id is null.
    expect(deliver).toContain("eq('id', conversation.id).is('ghl_conversation_id', null)");
    expect(deliver).not.toMatch(/delete\(\)|neq\('id', conversation\.id\)/);
  });
});

describe('EN and FR parity', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    expect(lookup(en, 'admin.workspace.header.whatsapp')).toBeTypeOf('string');
    expect(lookup(fr, 'admin.workspace.header.whatsapp')).toBeTypeOf('string');
    for (const reason of ['no_phone', 'provider_failed', 'ambiguous', 'contact_failed']) {
      const key = `admin.workspace.header.whatsappFail.${reason}`;
      expect(lookup(en, key), `${key} is not translated`).not.toBe(lookup(fr, key));
    }
    expect(String(lookup(en, 'admin.workspace.header.whatsappFail.no_phone')))
      .toMatch(/does not have a valid phone number on their account/i);
  });
});
