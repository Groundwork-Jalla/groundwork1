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

describe('the contractor never holds a credential for the client', () => {
  it('invites rather than provisions, and returns no password', () => {
    expect(handler).toMatch(/findOrCreateUserByEmail\(/);
    // admin-provision-user.ts returns a password on purpose. This must not.
    expect(handler).not.toMatch(/generateTemporaryPassword|password/);
    const ok = handler.slice(handler.indexOf('res.status(200).json('));
    expect(ok).not.toMatch(/password/);
  });

  it('checks contractor standing before it ever reaches the service role', () => {
    const gate = handler.indexOf("eq('role', 'contractor')");
    const invite = handler.indexOf('findOrCreateUserByEmail(');
    expect(gate).toBeGreaterThan(-1);
    expect(invite).toBeGreaterThan(gate);
    // Role OR accepted assignment — the same definition holdsContractorAccess uses, so
    // an invited contractor is a contractor here too.
    expect(handler).toMatch(/contractor_invites[\s\S]*?eq\('status', 'accepted'\)/);
  });

  it('answers a non-contractor the same way as a wrong path', () => {
    expect(handler).toMatch(/res\.status\(404\)\.json\(\{ error: 'Not found' \}\)/);
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
  it('the route and the button exist', () => {
    expect(routes).toMatch(/route\("work\/clients\/new",\s*"routes\/work\/clients\.new\.tsx"\)/);
    expect(home).toMatch(/to="\/work\/clients\/new"/);
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

  it('does not decide the plan — the wizard asks', () => {
    // A partner's client may be on any of the three. Naming one here would be a label
    // the database contradicts: clamp_project_tier_on_insert (061/062) rewrites any paid
    // tier from a non-admin browser request back to the free plan unless the client's
    // own subscription already entitles them. Paid plans arrive through Stripe.
    expect(page).toMatch(/tier: null/);
    expect(page).not.toMatch(/tier: 'jalla_management'|tier: 'self_verify'|tier: 'jalla_verify'/);
  });

  it('shows the plan step to a partner and skips it only for a fixed plan', () => {
    const wiz = strip2(read('src/app/routes/admin/projects.new.tsx'));
    expect(wiz).toMatch(/const planDecided = onBehalfOf\?\.tier != null;/);
    expect(wiz).toMatch(/if \(planDecided && step === 10\)/);
    expect(wiz).toMatch(/Step10PlanSelection/);
  });

  it('records the plan the client picked, not a fixed one, when none was fixed', () => {
    expect(step11).toMatch(/onBehalfOf\?\.tier \? \{ tier: onBehalfOf\.tier \} : \{\}/);
  });

  it('tells the partner who actually pays', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  contractorClient: {'), en.indexOf('\n  },', en.indexOf('  contractorClient: {')));
    expect(block).toMatch(/not charged to you/);
    expect(block).toMatch(/free plan until they do/);
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

  it('each driver lands back on their own surface', () => {
    // A contractor sent to /admin/projects would hit a page they cannot open.
    expect(step11).toMatch(/onBehalfOf\.by === 'partner' \? '\/work\/projects' : '\/admin\/projects'/);
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
    expect(handler).toMatch(/if \(!created\)/);
    expect(handler).toMatch(/client_exists/);
    // And only ever claims the account was new when it genuinely was.
    expect(handler).toMatch(/client_was_created: true/);
    const refuse = handler.indexOf('client_exists');
    const link = handler.indexOf('contractor_clients');
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

  it('the partner button is hidden when the feature is not on this database', () => {
    expect(home).toMatch(/canOnboard === true &&/);
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
