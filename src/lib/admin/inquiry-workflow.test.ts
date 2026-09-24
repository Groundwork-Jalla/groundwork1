import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INQUIRY_STATUSES, allowedTransitions, isInquiryStatus, isSettled } from './inquiry-workflow';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Slice 12. The quote-request queue is the whole contact path (075 took contractor phone
 * numbers away from the browser), so the danger here is not a missing feature — it is a
 * screen that implies an introduction was delivered when all that happened was a status
 * change.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const page = code('src/app/routes/admin/inquiries.tsx');
const migration = src('supabase/migrations/076_contractor_inquiries.sql');

describe('the lifecycle is the database CHECK constraint, not a list someone retyped', () => {
  it('matches 076 exactly', () => {
    // Read the constraint out of the migration rather than restating it here.
    const inConstraint = migration
      .match(/CHECK \(status IN \(([^)]+)\)\)/)![1]
      .match(/'([a-z_]+)'/g)!
      .map(s => s.replace(/'/g, ''));
    expect([...INQUIRY_STATUSES].sort()).toEqual([...inConstraint].sort());
  });

  it('offers every canonical value and nothing else', () => {
    expect(INQUIRY_STATUSES).toEqual(['open', 'introduced', 'declined', 'closed']);
    for (const s of INQUIRY_STATUSES) expect(isInquiryStatus(s)).toBe(true);
    for (const s of ['pending', 'contacted', 'won', 'lost', 'archived', '']) {
      expect(isInquiryStatus(s), `${s} is not in the CHECK constraint`).toBe(false);
    }
  });

  it('a transition never targets the state it is already in', () => {
    for (const from of INQUIRY_STATUSES) {
      const to = allowedTransitions(from);
      expect(to).not.toContain(from);
      expect(to).toHaveLength(3);
      for (const s of to) expect(isInquiryStatus(s)).toBe(true);
    }
  });

  it('a settled request can still be reopened — 076 forbids no edge', () => {
    expect(isSettled('declined')).toBe(true);
    expect(isSettled('closed')).toBe(true);
    expect(isSettled('open')).toBe(false);
    expect(allowedTransitions('closed')).toContain('open');
  });
});

describe('marking a request introduced sends nothing', () => {
  it('no provider, no message, no outbox anywhere on the page', () => {
    for (const banned of [
      'sendWhatsApp', 'sendMessage', 'sendConversationMessage', 'deliverMessage',
      'ghl', 'Ghl', 'GHL', 'resend', 'Resend', 'ghl_outbox', 'mailto:',
    ]) {
      expect(page, `${banned} would make a status change deliver something`).not.toContain(banned);
    }
  });

  it('says in words that the record is not a delivery', () => {
    expect(page).toContain('introducedMeans');
    const copy = String(lookup(en, 'admin.inquiries.introducedMeans'));
    // The three facts 076 cannot record must be named, not implied away.
    expect(copy).toMatch(/who/i);
    expect(copy).toMatch(/when/i);
    expect(copy).toMatch(/sends nothing/i);
  });
});

describe('it writes only what 076 lets it write', () => {
  it('status and admin_notes, through the existing data layer', () => {
    expect(page).toContain('updateInquiry');
    expect(page).toContain('admin_notes');
    // A trigger pins these; offering an input for one would be a control that lies.
    for (const pinned of ['contractor_id:', 'build_type:', 'location:', 'created_at:']) {
      expect(page, `${pinned} is pinned by the 076 trigger`).not.toContain(pinned);
    }
  });

  it('never writes the conversation or project it displays', () => {
    for (const banned of ['linkTicket', 'linkConversation', 'ensureProjectConversation', 'link_ticket']) {
      expect(page, `${banned} would invent a link 076 has no column for`).not.toContain(banned);
    }
    // And says so on the screen, so a reader does not assume the thread is the request's.
    expect(page).toContain('conversationNote');
  });

  it('adds no second conversation store', () => {
    expect(page).toContain('listConversations');
    expect(page).not.toContain("from('project_messages')");
    expect(page).not.toContain("from('conversations')");
  });
});

describe('relationships are read, never inferred', () => {
  it('an inquiry with no account claims no person', () => {
    // Every context read is guarded on user_id; nothing falls back to matching a name.
    expect(page).toContain('inquiry.user_id === null');
    expect(page).toContain('accountGone');
    expect(page).toContain('accountUnknown');
    for (const banned of ['ilike', 'matchByName', '.email ===', 'inquiry.name ===']) {
      expect(page, `${banned} would guess who filed this`).not.toContain(banned);
    }
  });

  it('context deep-links go to real admin destinations', () => {
    const routes = src('src/app/routes.ts');
    for (const dest of ['/admin/clients', '/admin/contractors', '/admin/inbox', '/admin/projects/']) {
      expect(page, `${dest} must be offered`).toContain(dest);
    }
    // Each one is a registered route, so no row leaves the Groundwork shell.
    for (const path of ['admin/clients', 'admin/contractors', 'admin/inbox', 'admin/projects/:id']) {
      expect(routes, `${path} must exist`).toContain(`"${path}"`);
    }
    expect(page, 'no external navigation from this queue').not.toMatch(/href=["']https?:/);
  });

  it('the selected request is an address, like the Inbox', () => {
    expect(page).toContain("params.get('inquiry')");
    expect(page).toContain('useSearchParams');
  });
});

describe('unavailable, empty and unknown stay three different answers', () => {
  it('each context panel can say all three', () => {
    for (const key of [
      'admin.inquiries.conversationsUnavailable', 'admin.inquiries.noConversations',
      'admin.inquiries.projectsUnavailable', 'admin.inquiries.noProjects',
      'admin.inquiries.accountUnknown', 'admin.inquiries.accountGone',
    ]) {
      expect(lookup(en, key), key).toBeTypeOf('string');
    }
    // `null` means unreadable; an empty list means none. The page must not conflate them.
    expect(page).toContain('people.threads === null');
    expect(page).toContain('people.projects === null');
  });

  it('a failed context read never becomes a count of zero', () => {
    expect(page).toContain('unavailable');
    expect(code('src/lib/supabase/admin-inquiries.ts')).not.toContain('catch');
  });
});

describe('EN and FR carry every new string', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.inquiries.detailTitle', 'admin.inquiries.detailSub', 'admin.inquiries.selectHint',
      'admin.inquiries.requester', 'admin.inquiries.contractorAsked', 'admin.inquiries.where',
      'admin.inquiries.buildType', 'admin.inquiries.notes', 'admin.inquiries.notesHint',
      'admin.inquiries.statusMeans', 'admin.inquiries.introducedMeans', 'admin.inquiries.settledMeans',
      'admin.inquiries.theirConversations', 'admin.inquiries.theirProjects',
      'admin.inquiries.conversationNote', 'admin.inquiries.askedAs', 'admin.inquiries.accountUnknown',
      'admin.inquiries.noConversations', 'admin.inquiries.noProjects',
      'admin.inquiries.conversationsUnavailable', 'admin.inquiries.projectsUnavailable',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
