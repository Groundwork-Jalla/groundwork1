import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A WhatsApp reply reaching the build it is about.
 *
 * 126 made the route one-way: a project message reached the client's phone, but a reply
 * typed in WhatsApp was filed on the PERSON's thread, which carries no project (091), so
 * it surfaced in the admin Inbox and the contractor who wrote the original never saw the
 * answer. That is a broadcast, not a chat.
 *
 * What is pinned here is the part that would be expensive to get wrong: a reply filed on
 * the WRONG building, our own outbound echoed back as if the client had said it, and the
 * same reply appearing twice.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

const inbound = code('api/_handlers/inbound.ts');
const m128    = read('supabase/migrations/128_whatsapp_reply_reaches_the_project.sql');
/** SQL with `--` comments removed, for assertions about what the code does NOT do:
 *  a comment explaining why something is wrong would otherwise read as doing it. */
const sql128  = m128.replace(/--.*$/gm, '');

describe('one project, or nobody guesses', () => {
  it('answers nothing when the person has several live builds', () => {
    // THE POINT. A reply says "the slab is fine" and nothing about which build. Filing it
    // on the wrong one puts a decision about one building into another building's record.
    expect(m128).toMatch(/WHERE \(SELECT count\(\*\) FROM mine\) = 1/);
  });

  it('and never resolves ambiguity by picking one', () => {
    // `LIMIT 1` here would choose a building at random.
    const fn = sql128.slice(sql128.indexOf('CREATE OR REPLACE FUNCTION public.project_for_whatsapp_reply'));
    expect(fn.slice(0, fn.indexOf('$$;'))).not.toMatch(/LIMIT 1/);
  });

  it('a finished or archived build does not make a one-project client ambiguous', () => {
    const occurrences = m128.match(/status NOT IN \('completed', 'archived'\)/g) ?? [];
    // All three routes, or the one that forgot it counts dead builds.
    expect(occurrences.length).toBe(3);
  });

  it('counts the same three routes project_participants does', () => {
    // If "who may read a thread" and "where a reply goes" disagree, a reply lands
    // somewhere its author cannot see it.
    expect(m128).toMatch(/p\.user_id = p_person/);
    expect(m128).toMatch(/ci\.status = 'accepted'/);
    expect(m128).toMatch(/pv\.status = 'active'/);
  });

  it('and one person on one build by two routes is still one build', () => {
    // UNION, not UNION ALL: an owner who is also the contractor would otherwise count
    // twice and look ambiguous to themselves.
    const fn = sql128.slice(sql128.indexOf('WITH mine AS'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).not.toMatch(/UNION ALL/);
    expect((body.match(/\bUNION\b/g) ?? []).length).toBe(2);
  });

  it('only the webhook may ask', () => {
    expect(m128).toMatch(/REVOKE ALL ON FUNCTION public\.project_for_whatsapp_reply\(uuid\) FROM PUBLIC, anon, authenticated/);
  });
});

describe('our own voice is never mirrored back as the client\'s', () => {
  it('a provider id we have sent stops there', () => {
    // 126 sends outbound through the same provider. An echo filed as inbound would put
    // words we wrote into the client's mouth, then fan them out again.
    expect(inbound).toMatch(/from\('message_deliveries'\)[\s\S]{0,120}eq\('provider_message_id', m\.ghlMessageId\)/);
    expect(inbound).toMatch(/if \(ours\.data && ours\.data\.length > 0\) return;/);
  });

  it('and the echo check happens before anything is written', () => {
    const helper = inbound.slice(inbound.indexOf('async function mirrorReplyToProject'));
    const guard  = helper.indexOf('provider_message_id');
    const write  = helper.indexOf("from('project_messages').insert");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
  });
});

describe('a replay does not say it twice', () => {
  it('only a first filing is mirrored', () => {
    expect(inbound).toMatch(/if \(!duplicate && m\.channel === 'whatsapp'\)/);
  });

  it('and the mirror does not claim the provider message id', () => {
    // 085's unique index already holds it for the row on the person's own thread.
    const helper = inbound.slice(inbound.indexOf('async function mirrorReplyToProject'));
    const insert = helper.slice(helper.indexOf("from('project_messages').insert"));
    expect(insert.slice(0, insert.indexOf('});'))).not.toMatch(/ghl_message_id/);
  });
});

describe('the mirror cannot start a loop', () => {
  it('it is recorded as whatsapp, which 126 does not fan out', () => {
    expect(inbound).toMatch(/channel:\s*'whatsapp'/);
    const m126 = read('supabase/migrations/126_message_reaches_the_phone.sql');
    expect(m126).toMatch(/COALESCE\(NEW\.channel, 'jalla'\) <> 'jalla'/);
  });

  it('and it is attributed to its author, so a fan-out would skip them anyway', () => {
    expect(inbound).toMatch(/sender_id:\s*personId/);
  });
});

describe('nothing here may cost the message', () => {
  it('a failed mirror leaves the reply filed and reachable', () => {
    // It is already in the Inbox; a mirror that failed is a message in the wrong place,
    // not a lost one.
    expect(inbound).toMatch(/await mirrorReplyToProject\(db, personId, m\);\s*\n\s*\} catch/);
  });

  it('an unplaceable reply keeps going where it always went', () => {
    expect(inbound).toMatch(/if \(!projectId\) return;/);
  });
});

describe('the reader can tell it came from a phone', () => {
  it('the member bubble names a non-Groundwork channel', () => {
    const thread = read('src/components/admin/conversations/ConversationThread.tsx');
    const bubbles = thread.match(/m\.channel !== 'jalla' && ` · \$\{t\(/g) ?? [];
    // Both the member's view and the staff one.
    expect(bubbles.length).toBe(2);
  });

  it('and the channel picker carries WhatsApp\'s own glyph', () => {
    const project = read('src/components/project/ProjectConversations.tsx');
    expect(project).toMatch(/channel === 'whatsapp'\) return <WhatsAppIcon/);
    // The others stay monochrome, so the green means something.
    expect(project).toMatch(/<Mail className/);
    expect(project).toMatch(/<Phone className/);
  });
});
