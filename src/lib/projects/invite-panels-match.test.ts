import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The two invite panels are one design.
 *
 * Favour, 7 Nov 2026: "the contractor invite side should look like the share this
 * build section. they should both have the same ui."
 *
 * They sit on the same screen and do the same job — put somebody on this build by
 * email — and they looked nothing alike. Share This Build was a card with the form
 * already open. Contractor Access was a bare heading, an "Invite Contractor" button
 * that toggled a form into existence, and an illustrated empty state the width of the
 * page. One of them made you click before it would show you anything.
 *
 * This file pins the shell they now share, because "they look the same" is the kind of
 * agreement that lasts until the next person edits one of them.
 */

const share      = readFileSync('src/components/project/ShareProject.tsx', 'utf8');
const contractor = readFileSync('src/components/project/ContractorInvite.tsx', 'utf8');

/**
 * Comments stripped, for the assertions about what is ABSENT.
 *
 * Both files explain at length what used to be there and why it went — "Contractor
 * Access was a bare heading", "there is nowhere to put a relationship". A plain
 * search finds that prose and reports the removed thing as still present, which is
 * the test failing on its own documentation.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const panels = [['ShareProject', share], ['ContractorInvite', contractor]] as const;

describe('both panels are built from the same pieces', () => {
  it.each(panels)('%s is one card, not a header and a page-wide block', (_name, src) => {
    expect(src).toMatch(
      /<section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-\[#2c2c2c\] dark:bg-\[#1e1e1e\]">/);
  });

  it.each(panels)('%s leads with an icon, a title and one line of explanation', (_name, src) => {
    expect(src).toMatch(/<h3 className="flex items-center gap-2 text-sm font-semibold/);
    expect(src).toMatch(/<p className="mt-0\.5 text-xs leading-relaxed text-brand-mid-grey">/);
  });

  it.each(panels)('%s shows its form straight away', (_name, src) => {
    // The whole complaint: a form you have to ask for is a form people do not find.
    expect(src).toMatch(/<form onSubmit=\{invite\} noValidate className="mt-4 grid gap-3 sm:grid-cols-\[/);
    expect(src).toMatch(/<Label htmlFor="\w+" className="text-xs">/);
    expect(src).toMatch(/<Button type="submit" disabled=\{busy\} className="h-9 text-xs">/);
  });

  it.each(panels)('%s lists who is on the build underneath, in the same row', (_name, src) => {
    expect(src).toMatch(/<ul className="mt-4 space-y-2">/);
    expect(src).toMatch(/rows\.length === 0 \? <li className="text-xs text-brand-mid-grey">/);
    expect(src).toMatch(/className="flex flex-wrap items-center justify-between gap-2 rounded-lg border/);
  });

  it.each(panels)('%s reports success and failure the same way', (_name, src) => {
    expect(src).toMatch(/text-xs text-state-complete/);
    expect(src).toMatch(/<p role="alert" className="mt-3 text-xs text-state-alert">/);
  });

  it('and the contractor panel no longer hides behind a toggle or an empty state', () => {
    expect(code(contractor)).not.toMatch(/showForm/);
    expect(code(contractor)).not.toMatch(/EmptyState/);
  });
});

describe('what the contractor panel keeps that the other does not', () => {
  it('does not impose a plan limit on contractor invitations', () => {
    expect(contractor).not.toMatch(/atCap|inviteUi\.capReached/);
  });

  it('and confirms removal, because a contractor loses a site they stand on', () => {
    expect(contractor).toMatch(/<ConfirmModal/);
    expect(contractor).toMatch(/destructive/);
  });

  it('but asks for no name, because there is nowhere to put one', () => {
    /**
     * `contractor_invites` stores project, email, role, status and token — no name.
     * ShareProject has the field because `project_viewers.relationship` holds the
     * client's name. A box whose contents are dropped on submit is worse than not
     * asking.
     */
    expect(code(contractor)).not.toMatch(/setRelationship|relationship/);
  });
});

describe('every string in the rebuilt panel is translated', () => {
  const keys = [
    'title', 'body', 'email', 'invite', 'sent', 'none', 'pending', 'accepted',
    'rejected', 'remove', 'removeBody', 'errEmail', 'errFailed', 'notEmailed',
    'capReached',
  ];
  it.each(keys)('inviteUi.%s', key => {
    for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
      const hit = lookup(dict as never, `inviteUi.${key}`);
      expect(typeof hit === 'string' && hit.length > 0, `${key} missing in ${lang}`).toBe(true);
    }
  });

  it('and none of the old hard-coded English survives', () => {
    // The panel shipped with "Contractor Access", "Invite Contractor", "Send Invite",
    // "Pending"/"Accepted"/"Rejected" and "Sent {date}" written straight into the JSX,
    // beside headings that were translated.
    for (const literal of ['Contractor Access', 'Invite Contractor', 'Send Invite', "'Pending'"]) {
      expect(code(contractor)).not.toContain(literal);
    }
  });
});
