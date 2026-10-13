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

  it("puts the client on the free plan, not Jalla's managed tier", () => {
    expect(page).toMatch(/tier: 'self_verify'/);
    expect(page).not.toMatch(/tier: 'jalla_management'/);
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
