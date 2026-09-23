import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * 06 §21 — Team inside the project workspace.
 *
 * An ADMINISTRATIVE surface: it shows the assignments and changes them. /contractors and
 * /verifiers are separate surfaces over the same rows, so nothing here may become an
 * admin-only copy of assignment state, and no contractor or verifier execution UI
 * (evidence upload, recording a visit) belongs in /admin.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const CARD = 'src/components/admin/workspace/TeamCard.tsx';

describe('the workspace says who is on the project', () => {
  const c = code(CARD);

  it('client, contractors and verifiers all come from the assembled workspace — no second read, no second model', () => {
    expect(c).toContain('const { owner, contractors, verifiers } = ws.team;');
    expect(c).not.toMatch(/supabase\.from\(|listAdminUsers|select\(/);
  });

  it('assignment is the existing RPC, not a table write', () => {
    const lib = code('src/lib/supabase/verifiers.ts');
    expect(lib).toContain("rpc('admin_assign_contractor'");
    expect(lib).toContain("p_project_id: projectId, p_email: email.trim()");
    expect(c).toContain('await assignContractor(ws.project.id, address);');
    expect(c).not.toMatch(/from\('contractor_invites'\)|from\('project_verifiers'\)/);
  });

  it('verifier assignment keeps the modal it already had', () => {
    expect(c).toContain('<AssignVerifierModal');
    expect(c).toContain("t('admin.verifier.assign')");
  });

  it('after any assignment the workspace reloads — nothing is patched locally', () => {
    expect(c).toContain('onChanged();');
    expect(c).not.toMatch(/setContractors|setVerifiers|contractors\.push/);
    expect(code('src/app/routes/admin/projects.detail.tsx'))
      .toContain('<OverviewTab loaded={loaded} stageId={stageId} onChanged={reload} onNotice={n => { setNotice(n); reload(); }} />');
  });

  it('empty is said plainly, and 086 missing is "not available" rather than "nobody"', () => {
    expect(c).toContain("t('admin.workspace.team.noContractor')");
    expect(c).toContain("t('admin.workspace.team.noVerifier')");
    expect(c).toContain("!available ? (");
    expect(c).toContain("t('admin.workspace.overview.domain.unavailable')");
  });

  it('is an admin view only: no evidence upload, no site update, no verification recording here', () => {
    expect(c).not.toMatch(/upload|evidence|site_update|recordVerification|requestVerification|approveStage/i);
  });

  it('renders no raw id', () => {
    expect(c).not.toMatch(/(?<!key=)\{(c|v|owner)\.id\}/);
    expect(c).not.toMatch(/\.slice\(0,\s*8\)/);
  });

  it('every string exists in both dictionaries and is translated', () => {
    for (const k of ['title', 'subtitle', 'client', 'contractors', 'verifiers', 'noContractor', 'noVerifier',
                     'assignContractor', 'contractorEmail', 'assign', 'assignHint', 'assigned',
                     'inviteStatus.pending', 'inviteStatus.accepted', 'inviteStatus.rejected']) {
      const e = lookup(en, `admin.workspace.team.${k}`), f = lookup(fr, `admin.workspace.team.${k}`);
      expect(e, k).toBeTypeOf('string');
      expect(f, k).toBeTypeOf('string');
      // 'Client' is the same word in both languages; everything else must differ.
      if (k !== 'client') expect(e, `${k} is not translated`).not.toBe(f);
    }
  });

  it('the project workspace does not become the contractor or verifier product', () => {
    // A guard for the boundary itself: /admin must not grow their execution screens.
    const detail = code('src/app/routes/admin/projects.detail.tsx');
    expect(detail).not.toMatch(/ContractorDashboard|VerifierDashboard|\/contractors\/|\/verifiers\//);
  });
});
