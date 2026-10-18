import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeWhatsAppBody } from './whatsapp-body';
import { siteLink } from '@/lib/site-url';

/**
 * A project message reaching the phone.
 *
 * Reported from testing: a client has a real WhatsApp number, their contractor writes to
 * them in Groundwork, and nothing arrives. The cause was a boundary — the one call that
 * makes a phone buzz was reachable only from the admin Inbox, on a `whatsapp` thread, for
 * an `outbound` message, and a contractor and client on the project's own thread are none
 * of those three.
 *
 * What is pinned here is the part that can go wrong quietly: an internal note reaching a
 * client, the same message sent twice, a loop, and a send nobody can account for.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments stripped: a rule described in prose is not a rule. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

const handler = code('api/_handlers/message-fanout.ts');
const m126    = read('supabase/migrations/126_message_reaches_the_phone.sql');

// Built, not written out: site-url.test.ts fails the build on a hardcoded origin here
// too, and it is right to — a fixture that pins the production host would still pass
// if the handler started mailing preview testers into live data.
const LINK = siteLink('projects/p1?tab=messages');

const body = (over: Partial<Parameters<typeof composeWhatsAppBody>[0]> = {}) =>
  composeWhatsAppBody({
    senderName: 'Ruth Nkeng', senderRole: 'contractor', projectName: 'Buea Residence',
    content: 'Foundation is poured.', hasAttachments: false, lang: 'en',
    link: LINK, ...over,
  });

describe('what arrives on the phone says who is speaking', () => {
  it('names the role, not just the person', () => {
    // THE POINT. A WhatsApp message arrives with no Groundwork around it; a bare name
    // does not say whether to treat this as progress, a sign-off, or a decision needed.
    expect(body()).toContain('*Ruth Nkeng* (Contractor)');
  });

  it.each([
    ['owner',      'Client'],
    ['contractor', 'Contractor'],
    ['verifier',   'Verifier'],
  ])('a %s reads as %s', (role, label) => {
    expect(body({ senderRole: role })).toContain(`(${label})`);
  });

  it('anybody who is not a participant reads as Jalla', () => {
    // Staff have no `project_participants` row, and must not be given one: that table
    // decides who may write on a thread and who is told about it.
    expect(body({ senderRole: 'staff' })).toContain('(Jalla)');
    expect(body({ senderRole: 'something-new' })).toContain('(Jalla)');
  });

  it('falls back to the role when the name is missing', () => {
    expect(body({ senderName: '' })).toContain('*Contractor* (Contractor)');
    expect(body({ senderName: '   ' })).not.toContain('**');
  });

  it('carries the message itself, and the project it is about', () => {
    const out = body();
    expect(out).toContain('Foundation is poured.');
    expect(out).toContain('Buea Residence');
  });

  it('ends with the way back into Groundwork', () => {
    // Answering belongs where the project keeps its record.
    expect(body().trimEnd().endsWith(LINK)).toBe(true);
    expect(body()).toContain('Reply in Groundwork');
  });

  it('says so when a file came with it, because WhatsApp text cannot carry one', () => {
    expect(body({ hasAttachments: true })).toMatch(/attachment/i);
    expect(body({ hasAttachments: false })).not.toMatch(/attachment/i);
  });

  it('speaks French to somebody who chose French', () => {
    const fr = body({ lang: 'fr', senderRole: 'contractor', hasAttachments: true });
    expect(fr).toContain('(Entrepreneur)');
    expect(fr).toContain('Répondre dans Groundwork');
    expect(fr).toContain('pièce jointe');
  });

  it.each([null, '', 'de'])('an unknown language preference (%s) reads as English', (lang) => {
    expect(body({ lang: lang as string | null })).toContain('Reply in Groundwork');
  });

  it('survives a project with no name', () => {
    // Rather than a trailing separator pointing at nothing.
    expect(body({ projectName: '' })).toContain('*Ruth Nkeng* (Contractor)\n');
    expect(body({ projectName: '' })).not.toContain('· \n');
  });
});

describe('an internal note never leaves Groundwork', () => {
  it('the trigger will not even ask', () => {
    expect(m126).toMatch(/IF NEW\.direction = 'internal' THEN RETURN NEW/);
  });

  it('and the handler refuses it again on its own', () => {
    // Restated rather than trusted: this endpoint is reachable with the shared secret
    // alone, and an internal note on a client's phone cannot be taken back.
    expect(handler).toMatch(/direction === 'internal'[\s\S]{0,200}internal_never_leaves/);
  });
});

describe('it cannot loop, for two independent reasons', () => {
  it('a message with no project is not carried', () => {
    // What the fan-out SENDS lands on a `whatsapp` conversation, which belongs to a person
    // and carries no project (091) — outside this trigger's reach. So a provider echo
    // cannot re-enter the fan-out.
    // 126 closed the loop by channel scope; 129 replaced that with the ledger's unique
    // index plus 128's echo check, because the WhatsApp button has to produce a
    // `whatsapp` message that IS carried. What both still require is a project.
    const m129 = read('supabase/migrations/129_choose_the_channel.sql');
    expect(m129).toMatch(/IF NEW\.project_id IS NULL THEN RETURN NEW; END IF;/);
    expect(handler).toMatch(/if \(!message\.project_id\) \{/);
  });

  it('and the ledger is unique per message, person and channel', () => {
    expect(m126).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,120}\(message_id, recipient_id, channel\)/);
  });
});

describe('a message is never sent twice, and never sent unaccounted for', () => {
  it('the row is claimed BEFORE the provider is called', () => {
    // This is what makes the unique index an idempotency guard rather than a report: a
    // second caller finds the row taken while the first is still in flight.
    const claim = handler.indexOf("from('message_deliveries').insert");
    // The CALL, not the import at the top of the file.
    const send  = handler.indexOf('await sendWhatsAppMessage(');
    expect(claim).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(claim);
    expect(handler).toMatch(/status: 'pending'/);
  });

  it('an already-claimed send is left alone rather than repeated', () => {
    expect(handler).toMatch(/23505/);
    expect(handler).toMatch(/'already'/);
  });

  it('a send that could not be recorded is not made at all', () => {
    // An unrecorded send is one nobody can tell happened.
    expect(handler).toMatch(/not_recorded/);
  });

  it('every outcome is written down, including the ordinary ones', () => {
    for (const status of ['sent', 'failed', 'skipped']) {
      expect(handler).toContain(`'${status}'`);
    }
    // `no_phone` is not a fault — plenty of people never gave us one — but it is the
    // answer to "why did they not get it?", so it is recorded rather than swallowed.
    expect(handler).toMatch(/finish\('skipped', thread\.reason\)/);
  });

  it('the ledger keeps a backlog of what never landed', () => {
    expect(m126).toMatch(/WHERE status IN \('pending', 'failed'\)/);
  });
});

describe('one person with no phone does not cost the others their message', () => {
  it('each recipient is resolved, sent and recorded on its own', () => {
    expect(handler).toMatch(/for \(const person of participants\)/);
    // `continue`, never `return`: a failure moves to the next person.
    expect(handler).toMatch(/await finish\('skipped', thread\.reason\);\s*continue;/);
  });

  it('and the endpoint still answers 200, because its caller is a trigger', () => {
    // A non-200 would only produce a retry that the ledger refuses.
    expect(handler).toMatch(/res\.status\(200\)\.json\(\{ ok: true, messageId, carried: results \}\)/);
  });

  it('nothing here may cost the message itself', () => {
    // An AFTER trigger that raises still aborts the statement.
    expect(m126).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*RAISE WARNING/);
  });
});

describe('who hears about it is decided in one place', () => {
  it('the same participant set that gets the bell and the email', () => {
    expect(handler).toMatch(/rpc\('project_participants'/);
  });

  it('minus whoever wrote it', () => {
    expect(handler).toMatch(/p\.userId !== message\.sender_id/);
  });
});

describe('the endpoint is not open', () => {
  it('a wrong or missing secret is refused', () => {
    expect(handler).toMatch(/secretMatches\(bearer\)[\s\S]{0,120}401/);
  });

  it('and NO secret configured does not mean everybody is authorised', () => {
    expect(handler).toMatch(/if \(candidates\.length === 0 \|\| !bearer\) return false;/);
  });

  it('the service role key is accepted, so no new variable has to be distributed', () => {
    // It is already in the environment. And it grants nothing extra: the only readers
    // of `app_config` are SECURITY DEFINER functions and service_role itself (058 keeps
    // RLS on with no policies), so anyone able to read the secret out of the database
    // to replay this call already holds that key.
    expect(handler).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
  });

  it('a dedicated secret still wins, so it can be rotated alone', () => {
    const i = (k: string) => handler.indexOf(k);
    expect(i('MESSAGE_FANOUT_SECRET')).toBeLessThan(i('AGENT_DISPATCH_SECRET'));
    expect(i('AGENT_DISPATCH_SECRET')).toBeLessThan(i('SUPABASE_SERVICE_ROLE_KEY'));
  });

  it('secrets are not compared with ===', () => {
    // `===` leaks length and prefix through timing. A small leak, and a free fix.
    expect(handler).toMatch(/timingSafeEqual\(c, bearer\)/);
    expect(handler).not.toMatch(/candidates\.includes\(bearer\)/);
  });

  it('it is the database that calls it, not a browser', () => {
    expect(m126).toMatch(/net\.http_post/);
    expect(m126).toMatch(/'Authorization', 'Bearer ' \|\| secret/);
  });

  it('unconfigured is a normal state, not a broken send', () => {
    // Nobody should be unable to send a message because a transport is not set up.
    expect(m126).toMatch(/IF endpoint IS NULL OR endpoint = '' OR secret IS NULL OR secret = ''\s*THEN\s*\n\s*RETURN NEW/);
  });
});

describe('the ledger is readable by the people who get asked about it', () => {
  it('admin can answer "did they actually get that?"', () => {
    expect(m126).toMatch(/CREATE POLICY "admin_read_message_deliveries"[\s\S]{0,160}public\.is_admin\(\)/);
  });

  it('and nobody writes it from a browser', () => {
    expect(m126).toMatch(/GRANT SELECT ON public\.message_deliveries TO authenticated/);
    expect(m126).not.toMatch(/FOR (INSERT|UPDATE|ALL)[\s\S]{0,80}message_deliveries/);
  });
});

describe('the thread rule has exactly one implementation', () => {
  it('both callers share it', () => {
    // Two copies of "one person, one chat" drift into two chats for one person.
    expect(code('api/_handlers/project-whatsapp.ts')).toMatch(/resolveOrEstablishWhatsApp/);
    expect(handler).toMatch(/resolveOrEstablishWhatsApp/);
  });

  it('and neither reopens a provider call of its own', () => {
    expect(code('api/_handlers/project-whatsapp.ts')).not.toMatch(/upsertContact|ensureConversation/);
  });
});

describe('the link is built, never hardcoded', () => {
  it('so a preview deployment does not mail testers into production', () => {
    expect(handler).toMatch(/siteLink\(`projects\/\$\{message\.project_id\}\?tab=messages`\)/);
  });

  it('and it names the messages tab, as 125 established', () => {
    expect(handler).toContain('?tab=messages');
  });
});
