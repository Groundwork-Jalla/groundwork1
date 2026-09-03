import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every email we send a *person* has to land on their GoHighLevel contact.
 *
 * That is the whole point of `api/ghl/_email-log.ts`: whoever follows up can see what we
 * already said instead of guessing. It only holds if two things stay true across the
 * whole of `api/`, and neither is visible to tsc or to a passing deploy.
 *
 * ── 1. A sender that forgets to log ──────────────────────────────────────────────────
 * The automatic contractor acknowledgement — the one email nearly every applicant gets,
 * and for most of them the only one — was missed when the logging went in. Four of five
 * senders wrote a note; the highest-volume one wrote nothing, so the CRM was blank for
 * exactly the people who had just arrived. Nothing failed. Nothing was logged.
 *
 * ── 2. `void logEmailToCrm(...)` ─────────────────────────────────────────────────────
 * Vercel freezes the instance the moment a handler responds. A floating promise is
 * suspended mid-flight, and this one needs a Supabase read plus one or two GHL round
 * trips before it writes anything — so the note never happens. The failure is invisible
 * from every direction: the email sends, the endpoint returns 200, no error is raised
 * anywhere, and the timeline is simply empty. It reads as GHL refusing us.
 *
 * Both are one-line mistakes that cost nothing at the time and produce a CRM that is
 * quietly wrong. Hence a test rather than a comment.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const API = join(ROOT, 'api');

/** Sends only to our own inbox, so there is no contact to write a note onto. */
const INTERNAL_ONLY = new Set(['api/agent-dispatch.ts']);

/**
 * Sends a message that is *already* on the contact's timeline.
 *
 * `conversation-delivery.ts` is the reply path: somebody types into the Conversations
 * thread in GoHighLevel, GHL posts it to us, and we send it through Resend. The message
 * was composed in the thread and is displayed there by GHL itself — writing it back
 * would put a second copy of every reply on the same contact, and the note would say the
 * reply came *from* us to the very thread it was typed into.
 *
 * Exempt for the opposite reason to INTERNAL_ONLY: not "no contact to write to", but
 * "already written, by the system that asked us to send it".
 */
const ALREADY_ON_THE_THREAD = new Set(['api/_handlers/conversation-delivery.ts']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [relative(ROOT, full)] : [];
  });
}

/**
 * Comments are stripped before anything is matched.
 *
 * Not fussiness: half these files *discuss* the rule, and the header of `_email-log.ts`
 * spells out `void logEmailToCrm(...)` as the thing not to do. Scanning raw text reads
 * the warning as the violation — and, worse, a handler that had its call deleted but
 * kept the comment explaining it would still look wired up.
 */
const stripComments = (src: string) =>
  src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

const files = tsFiles(API).map(path => {
  const src = readFileSync(join(ROOT, path), 'utf8');
  return { path, src, code: stripComments(src) };
});

describe('CRM email log', () => {
  it('is called by every endpoint that emails a person', () => {
    const senders = files.filter(f =>
      f.src.includes('https://api.resend.com/emails')
      && !INTERNAL_ONLY.has(f.path)
      && !ALREADY_ON_THE_THREAD.has(f.path));

    // If this is empty the test is passing for the wrong reason — a path change, or a
    // move off Resend — and would keep passing while the guarantee quietly lapsed.
    expect(senders.length, 'no Resend senders found — has the API moved?')
      .toBeGreaterThan(0);

    const missing = senders.filter(f => !f.code.includes('logEmailToCrm(')).map(f => f.path);
    expect(missing, `these send email to a person but write nothing to the CRM:\n` +
      missing.map(f => `  ${f}`).join('\n') +
      `\n\nAdd: await logEmailToCrm({ to, subject, html, kind })\n`).toEqual([]);
  });

  it('is always awaited, because a floating promise is killed by the freeze', () => {
    // Every call has to read `await logEmailToCrm(` — the token immediately before it is
    // the whole rule.
    const CALL = /(?:^|[^.\w])(await\s+)?logEmailToCrm\s*\(/g;

    const floating = files
      // The module that defines it is not a call site.
      .filter(f => f.path !== 'api/ghl/_email-log.ts')
      .filter(f => [...f.code.matchAll(CALL)].some(m => !m[1]))
      .map(f => f.path);

    expect(floating, `logEmailToCrm must be awaited before the handler responds:\n` +
      floating.map(f => `  ${f}`).join('\n') +
      `\n\nVercel freezes the instance at res.json(); an unawaited call never writes\n` +
      `the note, and nothing anywhere reports that it did not.\n`).toEqual([]);
  });

  it('labels what it sent, rather than filing everything as "Email"', () => {
    const callers = files.filter(f =>
      f.path !== 'api/ghl/_email-log.ts' && f.code.includes('logEmailToCrm('));

    const unlabelled = callers.filter(f => !/kind:\s*(?:'|callerEmailKind)/.test(f.code))
      .map(f => f.path);
    expect(unlabelled, `a note with no kind reads as a bare "Email" on the timeline:\n` +
      unlabelled.map(f => `  ${f}`).join('\n')).toEqual([]);
  });
});
