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

  it('which opens the build: its stages, the evidence, and the thread', () => {
    // `/verifiers/:id` is a VERIFICATION and answers a narrower question. Somebody
    // arriving from an assignment email needs the state of the build first.
    expect(projPage).toMatch(/loadProjectForVerifier/);
    expect(projPage).toMatch(/<ProjectConversations/);
    expect(projPage).toMatch(/signedFileUrl\('evidence', path\)/);
  });

  it('but records no finding — that stays in the verification workspace', () => {
    // The decision belongs beside the evidence for that one stage, not next to nine
    // others.
    expect(projPage).not.toMatch(/recordVerification/);
    expect(projPage).toMatch(/to=\{`\/verifiers\/\$\{stage\.verificationId\}`\}/);
  });

  it('and says so plainly when they are no longer assigned', () => {
    // RLS stops resolving the project once the assignment ends; an empty chat would
    // read as a broken page.
    expect(projPage).toMatch(/verifier\.project\.noAccess/);
    expect(projPage).toMatch(/if \(!p\) \{ setState\('denied'\); return; \}/);
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

describe('members can actually upload (131)', () => {
  const m131 = read('supabase/migrations/131_members_upload_documents.sql');
  const sql  = m131.replace(/--.*$/gm, '');

  it('the document row is no longer owner-only', () => {
    // `owner_insert_documents` (086) was WITH CHECK (project_id IN (SELECT id FROM
    // projects WHERE user_id = auth.uid())) — the owner and nobody else, which is why a
    // contractor's upload failed silently.
    expect(sql).toMatch(/DROP POLICY IF EXISTS "owner_insert_documents"/);
    expect(sql).toMatch(/CREATE POLICY "member_insert_documents"[\s\S]{0,200}public\.project_member\(project_id\)/);
  });

  it('and the uploader cannot be forged', () => {
    // The old policy got this free: only the owner could insert, so only the owner's id
    // could be there. Widening the WHO means saying it.
    expect(sql).toMatch(/AND uploaded_by = auth\.uid\(\)/);
  });

  it('deletion stays with the owner', () => {
    // A contractor who leaves should not take the record of the build with them.
    expect(sql).not.toMatch(/FOR DELETE/);
  });

  it('the documents BUCKET is widened too, or the row is written and the file is not', () => {
    expect(sql).toMatch(/CREATE POLICY "member_documents_upload"[\s\S]{0,260}bucket_id = 'documents'/);
  });

  it('and so is evidence, because verifiers upload theirs', () => {
    // `contractor_evidence_upload` (012) covers an accepted contractor and nobody else,
    // so a verifier photographing what they found had nowhere to put it.
    expect(sql).toMatch(/CREATE POLICY "member_evidence_upload"[\s\S]{0,260}bucket_id = 'evidence'/);
  });

  it('project_member covers all three roles, which is what makes one policy enough', () => {
    const m086 = read('supabase/migrations/086_verifiers.sql');
    const fn = m086.slice(m086.indexOf('FUNCTION public.project_member(p_project uuid)'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/p\.user_id = auth\.uid\(\)/);
    expect(body).toMatch(/ci\.status = 'accepted'/);
    expect(body).toMatch(/pv\.status = 'active'/);
  });

  it('a storage block that cannot be applied says so instead of aborting the file', () => {
    // storage.objects is not always owned by the role running a migration from the SQL
    // editor. `invalid_schema_name` is caught too, which 092 omits.
    expect((sql.match(/EXCEPTION WHEN insufficient_privilege OR undefined_table OR invalid_schema_name/g) ?? []).length).toBe(2);
    expect(m131).toMatch(/SKIPPED policy member_documents_upload/);
    expect(m131).toMatch(/SKIPPED policy member_evidence_upload/);
  });
});

describe('the contractor can reach, and make, a document', () => {
  const work  = read('src/app/routes/work/projects.detail.tsx');
  const shell = read('src/components/shell/WorkShell.tsx');
  const dash  = read('src/app/routes/work/index.tsx');

  it('no sidebar link points at an anchor the dashboard does not have', () => {
    /**
     * `#evidence`, `#documents` and `#payments` pointed at sections that do not exist,
     * so the browser had nothing to scroll to and left the contractor on a page that
     * was not what they clicked — reported as "it takes me to an empty page".
     *
     * As of the 29 Oct 2026 redesign the sidebar has NO anchor links at all: `#action`
     * went with the "needs action" tab it opened. So the list is expected to be empty,
     * and the rule below is what holds if one is ever added back.
     */
    const anchors = [...shell.matchAll(/to: '\/work#([a-z]+)'/g)].map(m => m[1]);
    for (const a of anchors) expect(dash, `#${a} has no section`).toMatch(new RegExp(`id="${a}"`));
  });

  it('and the needs-action tab it used to open is gone from the sidebar', () => {
    // The lit dot on a build's pipeline is the work. A second list of the same truth
    // is free to disagree with the first — see the comment in WorkShell.tsx.
    expect(shell).not.toMatch(/contractor\.needsAction\.title/);
    expect(shell).not.toMatch(/\/work#action/);
  });

  it('and the Documents tab no longer takes a loose upload', () => {
    /**
     * This used to assert the opposite, and was right to: the tab listed documents
     * and offered no way to add one, while a sidebar link pointed nowhere.
     *
     * Philip, 29 October 2026, reversed the requirement — a document dropped in at
     * random has no use, and the section is an organised collection of the
     * project's files. A photo that proves work goes against the stage item it
     * proves, on the Work tab, where it ticks that item off. 131's upload policy is
     * untouched, so the capability is still there for the stage form.
     */
    expect(work).not.toMatch(/uploadDocument\(project\.id, user\.id, f\)/);
    expect(work).not.toMatch(/contractorProject\.uploadDocument/);
  });

  it('and stage updates are still uploaded, from the Work tab', () => {
    // The door that replaced it, including the live camera Philip asked for.
    expect(work).toMatch(/capture="environment"/);
    expect(work).toMatch(/contractorSubmit\.takePhoto/);
    expect(work).toMatch(/contractorSubmit\.chooseFile/);
  });

  it('a rejected file says which rule it broke', () => {
    expect(work).toMatch(/project\.documents\.tooLarge/);
    expect(work).toMatch(/project\.documents\.badType/);
  });

  it('and a rejected file is refused before anything is sent', () => {
    // The loose-upload path is gone, so its partial-failure handling went with it.
    // What remains is the stage form, and the rule that matters there is unchanged:
    // every file is checked before one byte is uploaded.
    expect(work).toMatch(/const bad = picked\.find\(f => fileProblem\(f\)\)/);
    expect(work).toMatch(/setFiles\(prev => \[\.\.\.prev, \.\.\.picked\]\)/);
  });
});

describe('a verifier can see the build they are assigned to', () => {
  const dash  = read('src/app/routes/verifiers/index.tsx');
  const lib   = read('src/lib/supabase/verifier-work.ts');
  const modal = read('src/components/admin/team/AssignVerifierModal.tsx');

  it('the dashboard lists assignments, not only submitted work', () => {
    /**
     * Reported: "the verifier does not know what project they are assigned to."
     * The dashboard was built entirely on `stage_verifications` — work a contractor has
     * SUBMITTED. Production has two active assignments and zero of those rows, so every
     * assigned verifier saw an empty screen.
     */
    expect(lib).toMatch(/export async function listMyAssignedProjects/);
    expect(dash).toMatch(/listMyAssignedProjects\(user\.id\)/);
  });

  it('and each one links into the project, where the evidence is', () => {
    expect(dash).toMatch(/to=\{`\/verifiers\/projects\/\$\{p\.projectId\}`\}/);
  });

  it('only ACTIVE assignments, so a removed verifier loses the build', () => {
    const fn = lib.slice(lib.indexOf('export async function listMyAssignedProjects'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/\.eq\('status', 'active'\)/);
  });

  it('the pending count is one query, not one per project', () => {
    // A verifier on ten builds should not cost ten round trips on a phone.
    const fn = lib.slice(lib.indexOf('export async function listMyAssignedProjects'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/\.in\('project_id', ids\)/);
  });
});

describe('assigning a verifier where verification cannot happen says so', () => {
  const modal = read('src/components/admin/team/AssignVerifierModal.tsx');

  it('self_verify and starter are called out before the assignment is made', () => {
    /**
     * `verification_required` is derived from the tier (086):
     * `(p.tier NOT IN ('self_verify', 'starter'))`. On those tiers it is false for every
     * stage, so `request_verification` refuses with `not_required` and no verification
     * can ever exist. Production: 21 of 24 projects are self_verify, and the one with
     * verifiers assigned has verification_required = false on all ten stages.
     */
    expect(modal).toMatch(/project\.tier === 'self_verify' \|\| project\.tier === 'starter'/);
    expect(modal).toMatch(/admin\.verifier\.tierNoVerification/);
  });

  it('and the derivation it describes is still what 086 does', () => {
    expect(read('supabase/migrations/086_verifiers.sql'))
      .toMatch(/tier NOT IN \('self_verify', 'starter'\)/);
  });

  it('the assignment is still allowed — it is a warning, not a block', () => {
    // The verifier still gets the project, its stages and its evidence. Refusing would
    // remove a use the admin plainly wanted.
    expect(modal).not.toMatch(/disabled=\{[^}]*self_verify/);
  });
});
