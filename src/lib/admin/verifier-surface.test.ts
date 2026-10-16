import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destinationFor } from '@/components/ui/NotificationBell';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The verifier surface, as a place somebody actually works.
 *
 * Four gaps reported together, and they compound: a verifier was told about a message by
 * an email whose link 404'd, had no bell to be told in the app, no way to add the phone
 * number WhatsApp delivery depends on, and no way for an admin to take them off a project
 * once assigned.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments stripped, for assertions about what the code does NOT do: prose
 *  explaining why something is absent would otherwise read as doing it. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

const shell    = read('src/components/verifier/VerifierShell.tsx');
const layout   = read('src/app/routes/verifiers/_layout.tsx');
const routes   = read('src/app/routes.ts');
const settings = read('src/app/routes/verifiers/settings.tsx');
const projPage = read('src/app/routes/verifiers/projects.detail.tsx');
const team     = read('src/components/admin/workspace/TeamCard.tsx');

describe('the bell', () => {
  it('is mounted, so notifications have somewhere to appear', () => {
    // 123 wrote rows for a verifier like anybody else; they were written and never seen.
    expect(layout).toMatch(/<NotificationBell userId=\{session\.user\.id\} \/>/);
  });

  it('through the slot the contractor shell already uses, not a second header', () => {
    expect(shell).toMatch(/topBarActions\?: ReactNode/);
    expect(shell).toMatch(/topBarActions=\{topBarActions\}/);
  });
});

describe('a message notification now resolves', () => {
  const P = '11111111-2222-3333-4444-555555555555';

  it('the bell still builds the verifier link', () => {
    expect(destinationFor({ project_id: P, conversation_id: 'c', role: 'verifier' }))
      .toBe(`/verifiers/projects/${P}?tab=messages`);
  });

  it('and that is a real route now', () => {
    expect(routes).toMatch(/route\("verifiers\/projects\/:projectId", "routes\/verifiers\/projects\.detail\.tsx"\)/);
  });

  it('which opens the thread, not the verification workspace', () => {
    // `/verifiers/:id` is a VERIFICATION. A message names a project, and a verifier
    // records findings against an assignment — so this page is the conversation.
    expect(projPage).toMatch(/<ProjectConversations/);
    expect(projPage).not.toMatch(/VerificationWorkspace/);
  });

  it('and says so plainly when they are no longer assigned', () => {
    // RLS stops resolving the project once the assignment ends; an empty chat would
    // read as a broken page.
    expect(projPage).toMatch(/verifier\.project\.noAccess/);
    expect(projPage).toMatch(/if \(!data\) \{ setMissing\(true\); return; \}/);
  });
});

describe('a verifier can maintain their own details', () => {
  it('there is a settings page, reachable from the sidebar', () => {
    expect(routes).toMatch(/route\("verifiers\/settings", "routes\/verifiers\/settings\.tsx"\)/);
    expect(shell).toMatch(/to: '\/verifiers\/settings'/);
  });

  it('including the phone, which is what WhatsApp resolves against', () => {
    expect(settings).toMatch(/<PhoneField/);
    expect(settings).toMatch(/verifier\.settings\.phoneHint/);
  });

  it('but NOT their role, assignments or disciplines', () => {
    // Those are an administrator's (086). Self-service over them would be the role
    // granting itself work.
    expect(code('src/app/routes/verifiers/settings.tsx'))
      .not.toMatch(/user_roles|project_verifiers|assign_verifier|discipline/);
  });

  it('and the update touches only their own row', () => {
    expect(settings).toMatch(/\.update\(\{ full_name: fullName\.trim\(\), phone: phone \|\| null \}\)/);
    expect(settings).toMatch(/\.eq\('id', user\.id\)/);
  });
});

describe('an admin can take a verifier off a project', () => {
  it('the control exists and calls remove_verifier', () => {
    // `removeVerifier` has been in the lib the whole time with nothing calling it.
    expect(team).toMatch(/import \{ assignContractor, removeVerifier \}/);
    expect(team).toMatch(/await removeVerifier\(assignmentId\)/);
  });

  it('only on an ACTIVE assignment', () => {
    // `remove_verifier` matches on status = 'active'; offering it elsewhere would be a
    // button that silently does nothing.
    expect(team).toMatch(/v\.status === 'active' && \(/);
  });

  it('and it confirms first, because the access goes immediately', () => {
    expect(team).toMatch(/window\.confirm\(t\('admin\.verifier\.removeConfirm'/);
  });

  it('a refusal is reported in the admin\'s own words', () => {
    expect(team).toMatch(/not_admin/);
    expect(team).toMatch(/admin\.verifier\.removeFailed/);
  });
});

describe('every new string exists in both languages', () => {
  it.each([
    ['admin.verifier', ['removeOne', 'removeConfirm', 'removed', 'removeFailed', 'removeNotAdmin']],
    ['verifier.settings', ['sub', 'name', 'phone', 'phoneHint', 'email', 'emailFixed']],
    ['verifier.project', ['back', 'noAccess']],
  ] as [string, string[]][])('%s', (path, keys) => {
    for (const dict of [en, fr]) {
      const block = path.split('.').reduce<any>((o, k) => o?.[k], dict);
      expect(block, `${path} missing`).toBeTruthy();
      for (const k of keys) {
        expect(typeof block[k], `${path}.${k}`).toBe('string');
        expect(block[k].length).toBeGreaterThan(0);
      }
    }
  });

  it('and the French is translated, not copied', () => {
    expect((fr as any).verifier.settings.phone).toBe('Téléphone');
    expect((fr as any).admin.verifier.removeFailed).not.toBe((en as any).admin.verifier.removeFailed);
  });
});
