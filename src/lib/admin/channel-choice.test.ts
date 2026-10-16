import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Clicking WhatsApp actually sends over WhatsApp.
 *
 * Reported from testing: "when they click the WhatsApp button, they type their message,
 * and the contractor will receive it in their WhatsApp number, both in their phone and on
 * Groundwork." Four stacked reasons made that impossible, and each one alone was enough:
 *
 *   1. `send_message` HARDCODED 'jalla' as the channel, whatever thread you typed in.
 *   2. The WhatsApp tab was the person's OWN thread with Jalla, which carries no project.
 *   3. 126's trigger fired only on project-linked `jalla` rows, so (1)+(2) meant never.
 *   4. The UI never asked for delivery in member view at all.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const m129    = read('supabase/migrations/129_choose_the_channel.sql');
const sql129  = m129.replace(/--.*$/gm, '');
const thread  = read('src/components/admin/conversations/ConversationThread.tsx');
const project = read('src/components/project/ProjectConversations.tsx');
const lib     = read('src/lib/supabase/conversations.ts');

describe('the channel is the sender\'s choice, not a constant', () => {
  it('send_message no longer hardcodes jalla', () => {
    expect(sql129).not.toMatch(/v_dir, 'jalla', p_attachments/);
    expect(sql129).toMatch(/v_dir, v_chan, p_attachments/);
  });

  it('and defaults to the conversation\'s own, so every old caller is unchanged', () => {
    expect(sql129).toMatch(/COALESCE\(NULLIF\(btrim\(COALESCE\(p_channel, ''\), ''\), v_conv\.channel, 'jalla'\)|v_conv\.channel, 'jalla'\)/);
  });

  it('only a channel something can actually carry is accepted', () => {
    // Naming a channel nothing delivers would be a message that looks sent and is not.
    expect(sql129).toMatch(/IF v_chan NOT IN \('jalla', 'whatsapp'\) THEN/);
    expect(sql129).toMatch(/bad_channel/);
  });

  it('the old four-argument version is DROPPED, not left beside the new one', () => {
    // Adding a defaulted parameter creates a SECOND function; a four-argument call would
    // then match both and fail as ambiguous rather than picking one.
    expect(m129).toMatch(/DROP FUNCTION IF EXISTS public\.send_message\(uuid, text, text, jsonb\);/);
  });
});

describe('an internal note still cannot be carried anywhere', () => {
  it('it is forced back to jalla whatever the sender asked for', () => {
    expect(sql129).toMatch(/IF v_dir = 'internal' THEN v_chan := 'jalla'; END IF;/);
  });

  it('and the trigger refuses it independently', () => {
    expect(sql129).toMatch(/IF NEW\.direction = 'internal' THEN RETURN NEW; END IF;/);
  });
});

describe('the fan-out stops caring which channel', () => {
  it('a project message is carried whatever it was written on', () => {
    const fn = sql129.slice(sql129.indexOf('CREATE OR REPLACE FUNCTION public.fanout_message_to_phones'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).not.toMatch(/COALESCE\(NEW\.channel, 'jalla'\) <> 'jalla'/);
  });

  it('but a message with no project still is not', () => {
    // Nobody else to carry it to, and the person's own thread is already their phone.
    expect(sql129).toMatch(/IF NEW\.project_id IS NULL THEN RETURN NEW; END IF;/);
  });

  it('and the loop guard that replaces the old channel scope is named', () => {
    // 126 closed the loop by only firing on jalla. Widening removes that, so the ledger's
    // unique index and 128's echo check have to carry it — and they are the stronger pair.
    expect(m129).toMatch(/message_deliveries/);
    expect(m129).toMatch(/provider_message_id/);
  });
});

describe('the client sees the two ways to send, and picks one', () => {
  it('both tabs are offered on the project thread', () => {
    expect(project).toMatch(/\(\['jalla', 'whatsapp'\] as const\)\.map/);
  });

  it('shown even before either has been used', () => {
    // It is how you decide where the message goes, not a list of what already exists —
    // which is exactly why the client saw nothing before.
    expect(project).toMatch(/\{conversation\.projectId && \(/);
  });

  it('and WhatsApp carries its own glyph', () => {
    expect(project).toMatch(/<ChannelIcon channel=\{c\} \/>/);
  });

  it('the choice reaches the composer and the list', () => {
    expect(project).toMatch(/sendChannel=\{conversation\.projectId \? channel : undefined\}/);
    expect(project).toMatch(/showOnlyChannel=\{conversation\.projectId \? channel : undefined\}/);
  });

  it('and it is one conversation shown two ways, not two inboxes', () => {
    // Every message stays on the project's record either way; that is what makes "on
    // their phone AND on Groundwork" true rather than two halves to reconcile.
    expect(thread).toMatch(/messages\.filter\(m => m\.direction === 'internal' \|\| \(m\.channel \?\? 'jalla'\) === showOnlyChannel\)/);
  });
});

describe('the choice travels all the way to the database', () => {
  it('the composer sends it', () => {
    expect(thread).toMatch(/pending\.length \? pending : undefined,\s*\n\s*sendChannel,/);
  });

  it('the client library passes it as p_channel', () => {
    expect(lib).toMatch(/p_channel: channel \?\? null/);
  });

  it('and omitting it still means "the conversation\'s own"', () => {
    expect(lib).toMatch(/channel\?: Channel/);
  });
});
