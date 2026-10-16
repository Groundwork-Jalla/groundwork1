import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destinationFor } from '@/components/ui/NotificationBell';

/**
 * Being told about a message, and arriving at it.
 *
 * Both halves of this were broken and either one alone keeps it broken: the link has
 * to name the messages tab, AND the page has to read the tab out of the URL. The
 * pages held it in component state with a hardcoded default and never looked at
 * `?tab=`, so even a correct link landed on the project overview — which is exactly
 * what was reported from testing.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PROJECT = '11111111-2222-3333-4444-555555555555';

describe('a message notification opens the messages tab', () => {
  it.each([
    ['the owner',    undefined,     `/projects/${PROJECT}?tab=messages`],
    ['a contractor', 'contractor',  `/work/projects/${PROJECT}?tab=messages`],
    ['a verifier',   'verifier',    `/verifiers/projects/${PROJECT}?tab=messages`],
  ])('%s', (_who, role, expected) => {
    expect(destinationFor({
      project_id: PROJECT, conversation_id: 'c1', ...(role ? { role } : {}),
    })).toBe(expected);
  });

  it('each role goes to a surface it can actually open', () => {
    // /projects/<id> assumes an owner; a contractor sent there is bounced, which reads
    // as the product being broken rather than as a message waiting.
    expect(destinationFor({ project_id: PROJECT, conversation_id: 'c1', role: 'contractor' }))
      .toMatch(/^\/work\//);
  });

  it('a NON-message project notification still goes to the project itself', () => {
    // Only a message opens the messages tab. A stage or payment notification is about
    // the project, and dropping somebody into a chat would be the same bug inverted.
    expect(destinationFor({ project_id: PROJECT })).toBe(`/projects/${PROJECT}`);
  });

  it('a thread with no project goes to the messages surface', () => {
    expect(destinationFor({ conversation_id: 'c1' })).toBe('/messages');
  });

  it('and something with nothing to point at goes nowhere', () => {
    expect(destinationFor(null)).toBeNull();
    expect(destinationFor({})).toBeNull();
  });
});

describe('the pages read the tab the link names', () => {
  it.each([
    ['client',     'src/app/routes/projects/detail.tsx'],
    ['contractor', 'src/app/routes/work/projects.detail.tsx'],
  ])('%s project page initialises its tab from ?tab=', (_who, file) => {
    const src = read(file);
    expect(src).toMatch(/useState<Tab>\(\(\) => tabFromUrl\(searchParams\.get\('tab'\)\)\)/);
  });

  it.each([
    ['client',     'src/app/routes/projects/detail.tsx'],
    ['contractor', 'src/app/routes/work/projects.detail.tsx'],
  ])('%s validates it, so a stale value never renders a blank tab', (_who, file) => {
    const src = read(file);
    expect(src).toMatch(/ALL_TABS\.includes\(value as Tab\)/);
  });

  it.each([
    ['client',     'src/app/routes/projects/detail.tsx'],
    ['contractor', 'src/app/routes/work/projects.detail.tsx'],
  ])('%s writes it back, so the address matches the screen', (_who, file) => {
    expect(read(file)).toMatch(/setSearchParams\(/);
  });

  it('both list messages as a tab that exists', () => {
    for (const f of ['src/app/routes/projects/detail.tsx', 'src/app/routes/work/projects.detail.tsx']) {
      expect(read(f)).toMatch(/ALL_TABS[\s\S]{0,160}'messages'/);
    }
  });
});

describe('the email link names the tab too', () => {
  const m125 = read('supabase/migrations/125_message_link_opens_messages.sql');

  it.each(['contractor', 'verifier', 'owner'])('%s', (role) => {
    // 123 sent a contractor and a verifier to the bare project. Only the client's
    // link named the tab, so the three disagreed with each other.
    const line = new RegExp(`${role === 'owner' ? 'ELSE' : `WHEN '${role}'`}[\\s\\S]{0,200}?tab=messages`);
    expect(m125).toMatch(line);
  });

  it('every branch of it ends in the messages tab', () => {
    const fn = m125.slice(m125.indexOf('CREATE OR REPLACE FUNCTION public.message_link_for'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect((body.match(/\?tab=messages/g) ?? []).length).toBe(3);
  });
});

describe('the unread count is visible in both themes', () => {
  const bell = read('src/components/ui/NotificationBell.tsx');

  it('the badge ink flips with its background', () => {
    /**
     * THE REPORTED BUG. `--color-state-active` is "the colour of text" and flips with
     * the theme — #0a0a0a light, #f0f0f0 dark. Against a fixed `text-white` the count
     * was white on near-white: an unread badge with an invisible number.
     */
    expect(bell).toMatch(/bg-state-active[^"]*text-white dark:text-brand-near-black/);
  });

  it('and the panel is not light-only', () => {
    // It had no dark variants at all, in an app with an account-scoped dark mode.
    expect(bell).toMatch(/dark:bg-\[#1e1e1e\]/);
    expect(bell).toMatch(/dark:text-white/);
    expect((bell.match(/dark:/g) ?? []).length).toBeGreaterThan(5);
  });
});
