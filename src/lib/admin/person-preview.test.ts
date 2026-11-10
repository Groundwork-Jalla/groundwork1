import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePersonParam, personParam } from '@/lib/supabase/admin-person';

/**
 * One preview of a person's signup details, opened from every list that names them.
 *
 * Favour, 11 Nov 2026: "once I click on their name I should be able to see all their
 * details — from the user section, or the client section, or the contractor section."
 *
 * The panel is one component and one fetcher. These tests keep it that way: the next
 * list that shows a name has to open the same panel, and the fetcher has to stay a
 * reader. A second copy is how two admin screens come to disagree about one person.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the deep link', () => {
  it('carries a user id plainly and an application id with a prefix', () => {
    expect(personParam({ userId: 'u-1' })).toBe('u-1');
    expect(personParam({ applicationId: 'a-1' })).toBe('app:a-1');
    expect(parsePersonParam('u-1')).toEqual({ userId: 'u-1' });
    expect(parsePersonParam('app:a-1')).toEqual({ applicationId: 'a-1' });
  });

  it('prefers the user id when a reference has both', () => {
    expect(personParam({ userId: 'u-1', applicationId: 'a-1' })).toBe('u-1');
  });

  it('never puts an email in the URL', () => {
    // Personal data in a place that gets copied into chats and logs. An email-only
    // reference opens the panel in memory instead.
    expect(personParam({ email: 'ada@example.com' })).toBeNull();
  });

  it('treats an empty or malformed value as nothing to open', () => {
    expect(parsePersonParam(null)).toBeNull();
    expect(parsePersonParam('')).toBeNull();
    expect(parsePersonParam('app:')).toBeNull();
  });
});

describe('every list that names a person opens the same panel', () => {
  it.each([
    'src/app/routes/admin/users.tsx',
    'src/app/routes/admin/clients.tsx',
    'src/app/routes/admin/contractors.tsx',
  ])('%s', file => {
    const src = code(file);
    expect(src).toMatch(/from '@\/components\/admin\/PersonPreview'/);
    expect(src).toMatch(/usePersonPreview\(\)/);
    expect(src).toMatch(/<PersonPreview reference=\{person\.ref\}/);
    // Opened directly, or handed down to a card that opens it — the clients page
    // passes `onOpen={person.open}` to ClientCard rather than calling it inline.
    expect(src).toMatch(/person\.open\(|onOpen=\{person\.open\}/);
  });

  it('the contractor list opens by application or email, because a listing has no user id', () => {
    const src = code('src/app/routes/admin/contractors.tsx');
    expect(src).toMatch(/person\.open\(\{ applicationId: r\.applicationId, email: r\.email \}\)/);
  });

  it('global search lands on the person, not just the row', () => {
    const src = code('src/lib/supabase/admin-search.ts');
    expect(src).toMatch(/\/admin\/users\?q=\$\{encodeURIComponent\(u\.email\)\}&person=\$\{u\.id\}/);
  });
});

describe('the fetcher only reads', () => {
  const src = code('src/lib/supabase/admin-person.ts');

  it('never writes', () => {
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });

  it('reads the four places signup leaves a person', () => {
    for (const table of ['profiles', 'contractor_onboarding', 'contractor_applications', 'projects']) {
      expect(src, table).toMatch(new RegExp(`from\\('${table}'\\)`));
    }
  });

  it('does not read user_roles, which admins have no policy on (009)', () => {
    // Roles come from the row that opened the preview, or from admin_list_users().
    expect(src).not.toMatch(/from\('user_roles'\)/);
    expect(src).toMatch(/listAdminUsers\(\)/);
  });

  it('matches an email case-insensitively, like the invitation senders do', () => {
    expect(src).toMatch(/\.ilike\('email', email\)/);
  });
});

describe('the panel shows what exists and nothing else', () => {
  const src = code('src/components/admin/PersonPreview.tsx');

  it('renders a row only when it has a value', () => {
    expect(src).toMatch(/if \(!value\) return null;/);
  });

  it('says plainly when a listing has no account behind it', () => {
    expect(src).toMatch(/admin\.person\.noAccount/);
  });

  it('is labelled in both languages', () => {
    for (const file of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const dict = readFileSync(resolve(ROOT, file), 'utf8');
      expect(dict, file).toMatch(/\n    person: \{/);
      expect(dict, file).toMatch(/noAccount:/);
    }
  });
});
