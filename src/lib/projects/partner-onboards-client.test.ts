import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A partner contractor brings their own client (109).
 *
 * The risk this file guards is specific: 082 lets admins create a project for anyone with
 * a bare `is_admin()`. Giving contractors the same shape would let any contractor create
 * a project owned by any user on the platform. So the right is scoped to people they
 * actually invited, and these tests pin that scoping — plus the one thing a contractor
 * must never gain, which is a credential for somebody else's account.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip2 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const strip = (s: string) => s.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON [\s\S]*?;\s*$/gm, '');

const sql     = read('supabase/migrations/109_contractor_onboards_client.sql');
const sql110  = read('supabase/migrations/110_contractor_client_consent.sql');
const code110 = strip(sql110);
const code    = strip(sql);
const routes  = read('src/app/routes.ts');
const page    = strip2(read('src/app/routes/work/clients.new.tsx'));
const home    = strip2(read('src/app/routes/work/index.tsx'));
const step11  = strip2(read('src/components/wizard/steps/Step11ConfirmBudget.tsx'));
const handler = read('api/_handlers/contractor-invite-client.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the right is scoped to clients they actually brought', () => {
  it('every insert policy reads the link table, never a bare role check', () => {
    // A `WITH CHECK (holds the contractor role)` here would be the hole: any contractor
    // creating a project owned by any user, including staff.
    const policies = [...code.matchAll(/CREATE POLICY "contractor_insert_client_\w+"[\s\S]*?WITH CHECK \(([\s\S]*?)\);/g)]
      .map(m => m[1]);
    expect(policies).toHaveLength(5);   // projects, stages, substages, fees, documents
    for (const check of policies) {
      expect(check).toMatch(/is_my_client\(|is_my_clients_project\(/);
      expect(check).not.toMatch(/user_roles|is_admin\(\)/);
    }
  });

  it('the link table grants nobody INSERT — only the server writes it', () => {
    // If a contractor could insert their own row here they would award themselves any
    // client, and every policy above would follow.
    const onLink = [...code.matchAll(/ON public\.contractor_clients FOR (\w+)/g)].map(m => m[1]);
    expect(onLink.length).toBeGreaterThan(0);
    expect([...new Set(onLink)]).toEqual(['SELECT']);
  });

  it('a contractor reads only their own clients', () => {
    expect(code).toMatch(/USING \(contractor_id = auth\.uid\(\) OR client_id = auth\.uid\(\) OR public\.is_admin\(\)\)/);
  });

  it('taking the project refuses one that is not their client\'s, and makes them primary', () => {
    const fn = code.slice(code.indexOf('FUNCTION public.contractor_take_own_client_project'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/NOT public\.is_my_clients_project\(p_project\)/);
    expect(body).toMatch(/not_my_client/);
    expect(body).toMatch(/is_primary\)\s*\n?\s*VALUES[\s\S]*?true\)|,\s*true\)/);
    expect(body).toMatch(/'accepted'/);
  });
});

describe('the client alone sets their password from an email link', () => {
  it('arms both first-sign-in gates before sending the invitation', () => {
    // The invitation proves ownership of the inbox, while the database password gate
    // still refuses account access until the client chooses their own password.
    expect(handler).toMatch(/must_change_password:\s*true/);
    expect(handler).toMatch(/email_mfa_enabled:\s*true/);
    const armed = handler.indexOf('must_change_password');
    const invited = handler.indexOf('auth.admin.inviteUserByEmail(');
    expect(armed).toBeGreaterThan(-1);
    expect(invited).toBeGreaterThan(armed);
  });

  it('rolls the account back if those gates cannot be set', () => {
    expect(handler).toMatch(/profErr[\s\S]{0,300}?deleteUser\(clientId\)/);
  });

  it('refuses an address that already has an account', () => {
    // Knowing an existing user's address must not grant authority over their projects.
    expect(handler).toMatch(/ilike\('email', email\)/);
    expect(handler).toMatch(/client_exists/);
    const refuse = handler.indexOf('client_exists');
    const create = handler.indexOf('auth.admin.createUser');
    expect(create).toBeGreaterThan(refuse);
  });

  it('checks contractor standing before it ever reaches the service role', () => {
    const gate = handler.indexOf("eq('role', 'contractor')");
    const create = handler.indexOf('auth.admin.createUser');
    expect(gate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(gate);
    // Role OR accepted assignment — the same definition holdsContractorAccess uses.
    expect(handler).toMatch(/contractor_invites[\s\S]*?eq\('status', 'accepted'\)/);
  });

  it('answers a non-contractor the same way as a wrong path', () => {
    expect(handler).toMatch(/res\.status\(404\)\.json\(\{ error: 'Not found' \}\)/);
  });

  it('returns account identity only, without creating or storing a contractor-known password', () => {
    expect(handler).toMatch(/res\.status\(200\)\.json\(\{ clientId, email \}\)/);
    expect(handler).not.toMatch(/generateTemporaryPassword|\bpassword\s*[,=:]/);
    const lib = read('src/lib/supabase/contractor-clients.ts');
    expect(lib).not.toMatch(/localStorage|sessionStorage/);
    expect(lib).not.toMatch(/\bpassword\s*:/);
    expect(page).not.toMatch(/localStorage|sessionStorage/);
    expect(page).not.toMatch(/setPassword|type="password"|\.password\b/);
  });

  it('confirms the invitation BEFORE continuing to the existing project wizard', () => {
    expect(page).toMatch(/if \(client && showConfirmation\)/);
    expect(page).toMatch(/setShowConfirmation\(false\)/);
    expect(page).toMatch(/contractorClient\.emailSentTo/);
    const confirmation = page.indexOf('if (client && showConfirmation)');
    const wizard = page.indexOf('<WizardProvider');
    expect(confirmation).toBeGreaterThan(-1);
    expect(wizard).toBeGreaterThan(confirmation);
  });

  it('both languages explain the invitation and keep the password private to the client', () => {
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const all = read(f);
      const block = all.slice(all.indexOf('  contractorClient: {'));
      const copy = block.slice(0, block.indexOf('\n  },'));
      expect(copy, `${f}: missing setup email explanation`).toMatch(/invitationBody:/);
      expect(copy, `${f}: missing privacy explanation`).toMatch(/passwordPrivacy:/);
      expect(copy, `${f}: still offers a temporary password`).not.toMatch(/temporary password|mot de passe temporaire/i);
    }
  });

  it('tells the contractor the client must choose a password before account access', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  contractorClient: {'));
    const copy = block.slice(0, block.indexOf('\n  },'));
    expect(copy).toMatch(/secure link/);
    expect(copy).toMatch(/create their own password before they can access their account/);
    expect(copy).toMatch(/Only your client chooses and knows their password/);
  });

  it('the invite email opens password setup on the client device using a token hash', () => {
    const template = read('docs/supabase-email-templates/invite-user.html');
    expect(template).toContain('/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite');
    expect(template).toMatch(/Set your password/);
    expect(template).not.toContain('{{ .Token }}');
  });
});

describe('the widened budget gate stays in step with the original', () => {
  /**
   * 109 reproduces `admin_start_project_tracking` from 072 with ONE line changed, so a
   * partner can finish the wizard they are allowed to start. A copy that falls behind
   * its original is worse than no copy, so this compares the two bodies directly.
   */
  it('differs from 072 only in who may call it', () => {
    const original = read('supabase/migrations/072_professional_fee_breakdown.sql');
    const grab = (s: string) =>
      /CREATE OR REPLACE FUNCTION public\.admin_start_project_tracking\([\s\S]*?\$\$;/.exec(s)?.[0] ?? '';

    const a = grab(original);
    const b = grab(sql);
    expect(a, '072 no longer defines it — re-point this test').not.toBe('');
    expect(b, '109 no longer carries the widened copy').not.toBe('');

    // Normalise away comments and the gate line itself; everything else must match.
    const norm = (s: string) => s
      .replace(/^\s*--.*$/gm, '')
      .replace(/IF NOT \(?public\.is_admin\(\)[\s\S]*?END IF;/, 'GATE')
      .replace(/\s+/g, ' ').trim();

    expect(norm(b)).toBe(norm(a));
  });

  it('the widened gate is narrow — their own client\'s project, not any project', () => {
    const b = /CREATE OR REPLACE FUNCTION public\.admin_start_project_tracking\([\s\S]*?\$\$;/.exec(sql)?.[0] ?? '';
    expect(b).toMatch(/public\.is_admin\(\) OR public\.is_my_clients_project\(p_project_id\)/);
  });
});


describe('the partner can actually reach it', () => {
  it('the route exists', () => {
    expect(routes).toMatch(/route\("work\/clients\/new",\s*"routes\/work\/clients\.new\.tsx"\)/);
  });

  // The dashboard card that used to link here now offers "Create project" instead:
  // most contractors are not partners and have no client to bring, and the old CTA
  // answered a question they had not reached. The partner flow itself is unchanged —
  // but NOTHING in the UI navigates to it any more. If a way back in is added, assert
  // it here rather than restoring the assertion on the dashboard.
  it('the dashboard sends a contractor to their own project', () => {
    expect(home).toMatch(/to="\/projects\/new"/);
    expect(home).not.toMatch(/to="\/work\/clients\/new"/);
  });

  it('invites BEFORE the wizard, so no project is ever written without a link', () => {
    // 109's policies only permit a project whose owner this contractor brought on. If
    // the wizard ran first every insert would be refused at the last step.
    const invite = page.indexOf('inviteMyClient(');
    const wizard = page.indexOf('<WizardProvider');
    expect(invite).toBeGreaterThan(-1);
    expect(wizard).toBeGreaterThan(invite);
  });

  it('runs the SAME wizard an admin runs, not a copy', () => {
    // Two wizards would drift into two different estimates for the same building.
    expect(page).toMatch(/import \{ ManagedWizard \}/);
    expect(page).toMatch(/<ManagedWizard \/>/);
  });

  it('automatically creates the client project on Self Verify', () => {
    expect(page).toMatch(/tier: 'self_verify'/);
    expect(page).not.toMatch(/tier: null|tier: 'jalla_management'|tier: 'jalla_verify'/);
  });

  it('does not include the plan step in managed project creation', () => {
    const wiz = strip2(read('src/app/routes/admin/projects.new.tsx'));
    expect(wiz).not.toMatch(/Step10PlanSelection/);
  });

  it('saves the fixed plan and keeps the client as owner', () => {
    expect(step11).toMatch(/onBehalfOf\?\.tier \? \{ tier: onBehalfOf\.tier \} : \{\}/);
    expect(step11).toMatch(/const ownerId = onBehalfOf\?\.userId \?\? user\.id/);
  });

  it('explains automatic Self Verify and immediate project creation', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  contractorClient: {'), en.indexOf('\n  },', en.indexOf('  contractorClient: {')));
    expect(block).toMatch(/automatically created on Self Verify/);
    expect(block).toMatch(/build it immediately while they set their password/);
  });
});

describe('the wizard knows which of the two is driving it', () => {
  it('a partner takes their place on the project before the budget call', () => {
    // The widened budget gate is `is_my_clients_project`, which holds either way — but
    // membership and primary standing are what make the project theirs, and doing it
    // first means a failure leaves no project they are not on.
    const take = step11.indexOf('takeOwnClientProject(project.id)');
    const budget = step11.indexOf('adminStartProjectTracking(');
    expect(take).toBeGreaterThan(-1);
    expect(budget).toBeGreaterThan(take);
    expect(step11).toMatch(/onBehalfOf\?\.by === 'partner'/);
  });

  it('each driver lands back on their own surface, on the project they just made', () => {
    // A contractor sent to /admin/projects would hit a page they cannot open. And
    // each lands on the PROJECT, not the list: somebody who has just built one wants
    // to see it, which is what they said on 29 October.
    expect(step11).toMatch(/onBehalfOf\.by === 'partner'\s*\n?\s*\? `\/work\/projects\/\$\{project\.id\}`\s*\n?\s*: `\/admin\/projects\/\$\{project\.id\}`/);
  });

  it('the admin path still declares itself, so neither is the default', () => {
    expect(strip2(read('src/app/routes/admin/projects.new.tsx'))).toMatch(/by: 'admin'/);
  });
});

describe('a client inviting a contractor to their own project still works', () => {
  /**
   * The older, opposite direction: the CLIENT owns a project and invites a contractor
   * onto it. 109 adds a second way for a contractor and a project to meet, and must not
   * have disturbed the first.
   */
  it('the invite panel is still mounted on the client project page', () => {
    expect(strip2(read('src/app/routes/projects/detail.tsx'))).toMatch(/import ContractorInvite/);
    expect(read('src/components/project/ContractorInvite.tsx')).toMatch(/inviteContractor\(/);
  });

  it('109 never touches the policy that lets an owner invite', () => {
    // Its own RPC writes contractor_invites under SECURITY DEFINER, which is a different
    // thing from changing who may write it directly.
    expect(code).not.toMatch(/POLICY[\s\S]{0,120}?ON public\.contractor_invites/);
    expect(code).not.toMatch(/DROP POLICY[\s\S]{0,80}?contractor_invites/);
  });

  it('a partner taking their own project cannot overwrite an existing invite', () => {
    // ON CONFLICT updates status, never the contractor already recorded on somebody
    // else's invite row — and the function refuses a project that is not their client's.
    const fn = code.slice(code.indexOf('FUNCTION public.contractor_take_own_client_project'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/ON CONFLICT \(project_id, email\) DO UPDATE/);
    expect(body).toMatch(/NOT public\.is_my_clients_project\(p_project\)/);
  });
});


describe('110 — a link only grants when the client actually is one', () => {
  /**
   * THE HOLE 109 SHIPPED WITH. `findOrCreateUserByEmail` returns an EXISTING account
   * silently, and the handler wrote the link regardless. A contractor who knew any
   * address on the platform could name it and then create projects owned by that person
   * — becoming primary contractor on them, which is the position a release pays, while
   * the victim was told nothing.
   */

  it('both gates require a new account or an explicit acceptance', () => {
    for (const fn of ['is_my_client', 'is_my_clients_project']) {
      const at = code110.indexOf(`FUNCTION public.${fn}(`);
      expect(at, `110 must redefine ${fn}`).toBeGreaterThan(-1);
      const body = code110.slice(at, code110.indexOf('$$;', at));
      expect(body, `${fn} must not grant on the bare link`)
        .toMatch(/cc\.client_was_created OR cc\.accepted_at IS NOT NULL/);
    }
  });

  it('fails closed on every row written before the fix', () => {
    // We cannot tell after the fact which addresses were new, so the default is no.
    expect(code110).toMatch(/client_was_created boolean NOT NULL DEFAULT false/);
  });

  it('a link cannot be promoted to "newly created" afterwards', () => {
    expect(code110).toMatch(/cannot_promote/);
    expect(code110).toMatch(/TG_OP = 'UPDATE' AND NEW\.client_was_created AND NOT OLD\.client_was_created/);
  });

  it('only the client named on a link may accept it', () => {
    const at = code110.indexOf('FUNCTION public.accept_contractor_link');
    const body = code110.slice(at, code110.indexOf('$$;', at));
    expect(body).toMatch(/v_row\.client_id <> v_actor/);
    expect(body).toMatch(/not_yours/);
  });

  it('the handler refuses an address that already has an account', () => {
    // The refusal is now the profiles lookup before createUser, not a post-hoc check on
    // what find-or-create returned — but the rule and its reason are unchanged.
    expect(handler).toMatch(/ilike\('email', email\)/);
    expect(handler).toMatch(/client_exists/);
    // The link may only ever claim the account was new when this handler made it.
    expect(handler).toMatch(/client_was_created: true/);
    const refuse = handler.indexOf('client_exists');
    // GET reads the same table to recover an unfinished client; only the POST upsert
    // grants a new link, so the duplicate refusal must precede that write.
    const link = handler.search(/\.from\('contractor_clients'\)\s*\.upsert\(/);
    expect(link, 'the refusal must come before the link is written').toBeGreaterThan(refuse);
  });

  it('taking a project sets primary on a retry, without stealing it', () => {
    const at = code110.indexOf('FUNCTION public.contractor_take_own_client_project');
    const body = code110.slice(at, code110.indexOf('$$;', at));
    // 109 set is_primary only in the INSERT, so a row the client created first stayed
    // non-primary and the partner who built the project would not have been paid.
    expect(body).toMatch(/is_primary\s*=\s*public\.contractor_invites\.is_primary OR NOT v_other/);
    // 101 allows one primary per project; taking somebody else's is a staff decision.
    expect(body).toMatch(/WHERE project_id = p_project AND is_primary/);
  });
});

describe('the fixes that are not SQL', () => {
  it('a failed role grant is reported, not swallowed', () => {
    const cb = read('src/app/routes/auth/callback.tsx');
    expect(cb).toMatch(/roleNotGranted/);
    expect(cb).toMatch(/navigate\('\/contractor-signup', \{ replace: true \}\)/);
    expect(cb).toMatch(/navigate\('\/verifier-signup', \{ replace: true \}\)/);
  });

  it('the partner feature can still report whether this database has it', () => {
    // The dashboard no longer gates a button on this, but clients.new.tsx still reads
    // it, so the helper must survive.
    expect(read('src/lib/supabase/contractor-clients.ts')).toMatch(/partnerOnboardingAvailable/);
  });

  it('the joining assessment is reachable, and only on a pre-existing stage', () => {
    const panel = read('src/components/admin/workspace/SelectedStagePanel.tsx');
    expect(panel).toMatch(/JoiningAssessmentPanel/);
    expect(panel).toMatch(/view\.lifecycle\.state === 'pre_existing' &&/);
    expect(read('src/components/admin/workspace/JoiningAssessment.tsx')).toMatch(/recordJoiningAssessment\(/);
  });

  it('the client is told their project was set up for them', () => {
    const detail = read('src/app/routes/projects/detail.tsx');
    expect(detail).toMatch(/project\.created_by &&/);
    expect(detail).toMatch(/project\.overview\.setUpForYou/);
  });
});


describe('113 — removing a contractor, listed or not', () => {
  const sql113 = read('supabase/migrations/113_remove_contractor.sql');
  const code113 = strip(sql113);
  const roster  = strip2(read('src/components/admin/PublishContractor.tsx'));

  it('revokes the role AND withdraws assignments — either alone does nothing', () => {
    // holdsContractorAccess is "role OR accepted assignment", so removing just the role
    // leaves anybody on a project still able to sign in and work.
    const fn = code113.slice(code113.indexOf('FUNCTION public.admin_remove_contractor'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/DELETE FROM public\.user_roles[\s\S]*?role = 'contractor'/);
    expect(body).toMatch(/UPDATE public\.contractor_invites[\s\S]*?status = 'rejected', is_primary = false/);
  });

  it('refuses while a release is on its way to them', () => {
    const fn = code113.slice(code113.indexOf('FUNCTION public.admin_remove_contractor'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/'release_authorised', 'initiated', 'reconciling'/);
    expect(body).toMatch(/money_in_flight/);
    // disbursed and failed are final and must NOT block.
    expect(body).not.toMatch(/'disbursed'|'failed'/);
  });

  it('REMOVE never deletes the account — that is the other function', () => {
    // Two different acts, deliberately separate: one ends access and keeps the person,
    // the other ends the account. Removing must never quietly do the second.
    const fn = code113.slice(code113.indexOf('FUNCTION public.admin_remove_contractor'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).not.toMatch(/DELETE FROM auth\.users/);
    // The listing is taken down, not deleted, so a reinstatement keeps its reviews.
    expect(body).toMatch(/UPDATE public\.contractors SET active = false/);
    expect(body).not.toMatch(/DELETE FROM public\.contractors/);
  });

  it('DELETE never tries it in SQL — postgres cannot touch auth.users', () => {
    // 113 ended with `DELETE FROM auth.users`, which could never have worked: the auth
    // schema belongs to supabase_auth_admin, so a SECURITY DEFINER function owned by
    // postgres raises insufficient_privilege every time. 114 drops it.
    const sql114 = read('supabase/migrations/114_delete_contractor_precheck.sql');
    expect(sql114).toMatch(/DROP FUNCTION IF EXISTS public\.admin_delete_contractor\(uuid, text\)/);
    expect(strip(sql114)).not.toMatch(/DELETE FROM auth\.users/);
  });

  it('the decision stays in SQL, and names every refusal', () => {
    const sql114 = strip(read('supabase/migrations/114_delete_contractor_precheck.sql'));
    const fn = sql114.slice(sql114.indexOf('FUNCTION public.admin_can_delete_contractor'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    for (const reason of ['not_admin', 'self_removal', 'is_admin_account', 'money_in_flight', 'has_history']) {
      expect(body, `missing refusal: ${reason}`).toContain(reason);
    }
    // History is the six references that carry no cascade — the record of who did what
    // on somebody else's build.
    expect(body).toMatch(/site_updates[\s\S]*?stage_verifications[\s\S]*?project_documents/);
  });

  it('purges in SQL, then deletes through the service role', () => {
    // Two halves because two owners: postgres owns the public tables, supabase_auth_admin
    // owns auth.users, and neither can do the other's part.
    const h = read('api/_handlers/admin-delete-contractor.ts');
    const purge = h.indexOf("rpc('admin_purge_contractor'");
    const del = h.indexOf('deleteUser(userId)');
    expect(purge).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(purge);
    // The purge runs as the CALLER, because its is_admin() reads auth.uid().
    expect(h).toMatch(/asCaller\.rpc\('admin_purge_contractor'/);
  });

  it('a failure after the purge is reported, never guessed at', () => {
    // An earlier version called every deleteUser failure `has_history` — a confident
    // sentence about a cause nobody had checked, which sent the reader to the wrong place.
    const h = read('api/_handlers/admin-delete-contractor.ts');
    expect(h).toMatch(/error: 'delete_failed', detail: delErr\.message/);
    expect(h).not.toMatch(/error: 'has_history', detail/);
  });

  it('115 clears every reference that would block the delete', () => {
    const sql115 = strip(read('supabase/migrations/115_purge_contractor.sql'));
    // The six NOT NULL references are erased...
    for (const tbl of ['site_updates', 'stage_verifications', 'project_documents',
                       'project_takeoffs', 'project_messages', 'contractor_invites']) {
      expect(sql115, `must clear ${tbl}`).toMatch(new RegExp(`DELETE FROM public\\.${tbl}`));
    }
    // ...and the three nullable ones keep the fact, losing only the name.
    expect(sql115).toMatch(/UPDATE public\.project_audit_log\s+SET actor_id\s+= NULL/);
    expect(sql115).toMatch(/UPDATE public\.project_substages\s+SET approved_by = NULL/);
    expect(sql115).toMatch(/UPDATE public\.projects\s+SET created_by\s+= NULL/);
  });

  it('the cost is shown before the button, since it reaches other builds', () => {
    expect(roster).toMatch(/contractorDeleteImpact\(/);
    expect(roster).toMatch(/willErase/);
  });

  it('the roster offers both, and they are not the same button', () => {
    expect(roster).toMatch(/admin\.removeContractor\.confirm/);
    expect(roster).toMatch(/admin\.removeContractor\.deleteCta/);
    expect(roster).toMatch(/mode === 'delete' \? doDelete\(r\) : doRemove\(r\)/);
    // The confirmation promises opposite things, so it must say which.
    expect(roster).toMatch(/willDelete' : 'admin\.removeContractor\.willKeep/);
  });

  it('is admin-only and cannot be turned on yourself', () => {
    const fn = code113.slice(code113.indexOf('FUNCTION public.admin_remove_contractor'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/NOT public\.is_admin\(\)/);
    expect(body).toMatch(/self_removal/);
  });

  it('the roster reaches contractors who were never published', () => {
    // The old panel listed only unlisted contractors, so somebody in the directory could
    // not be removed from it, and 111's publish-only list could not remove at all.
    const fn = code113.slice(code113.indexOf('FUNCTION public.admin_all_contractors'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/role = 'contractor'[\s\S]*?OR EXISTS[\s\S]*?status = 'accepted'/);
    expect(roster).toMatch(/listAllContractors\(\)/);
  });

  it('the remove button sits beside publish, on every row', () => {
    expect(roster).toMatch(/admin\.removeContractor\.confirm/);
    expect(roster).toMatch(/admin\.publishContractor\.choose/);
    // Publish only when they are not already shown; remove always.
    expect(roster).toMatch(/!r\.listingActive && \(/);
  });

  it('says what removal costs before it happens', () => {
    expect(roster).toMatch(/checkContractorRemoval\(/);
    expect(roster).toMatch(/willProjects/);
    expect(roster).toMatch(/willKeep/);
  });
});
