import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 087's behaviour was proven on a local Postgres (every guard, the on-behalf rules, the
 * approval gate, the back-door trigger). These pin the SHAPE so an edit cannot quietly
 * merge the two authorities — verification and approval — or let the admin stand in
 * for the verifier without saying so.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql  = read('supabase/migrations/087_stage_verifications.sql');
const approvals = read('src/lib/supabase/approvals.ts');

describe('verification and approval are two authorities', () => {
  it('approve_stage refuses without a verified decision where required', () => {
    expect(sql).toMatch(/IF v_stage\.verification_required THEN[\s\S]{0,400}RAISE EXCEPTION 'not_verified:/);
  });
  it('a verifier cannot approve — only admin, or the owner of a Self Verify project', () => {
    expect(sql).toMatch(/IF NOT v_admin AND NOT \(v_owner AND v_self\) THEN\s+RAISE EXCEPTION 'not_authorized:/);
  });
  it('the status write to complete is guarded by a trigger keyed on a transaction-local flag', () => {
    expect(sql).toMatch(/set_config\('app\.approve_stage', 'on', true\)/);
    expect(sql).toMatch(/current_setting\('app\.approve_stage', true\) IS DISTINCT FROM 'on'[\s\S]{0,80}RAISE EXCEPTION 'approve_via_rpc:/);
    expect(sql).toMatch(/CREATE TRIGGER stages_guard_completion\s+BEFORE UPDATE OF status ON public\.project_stages/);
  });
  it('the four stored statuses are untouched, and no derived state is stored', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.project_stages[\s\S]{0,120}(status|CHECK)/);
    // Comments may describe the chain (eligibility, 090); the DDL may not create it.
    const ddl = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(ddl).not.toMatch(/lifecycle_status|eligib|health_band|action_center/i);
  });
});

describe('admin on behalf of a verifier is strict, in the database', () => {
  it('on_behalf must equal verifier_id and carry a reason — a CHECK, not UI', () => {
    expect(sql).toMatch(/CONSTRAINT stage_verifications_on_behalf_strict\s+CHECK \(recorded_on_behalf_of IS NULL\s+OR \(recorded_on_behalf_of = verifier_id AND reason IS NOT NULL AND btrim\(reason\) <> ''\)\)/);
  });
  it('record_verification names each refusal', () => {
    for (const code of ['not_verifier', 'on_behalf_required', 'on_behalf_mismatch', 'reason_required', 'on_behalf_not_applicable', 'already_decided']) {
      expect(sql, code).toMatch(new RegExp(`RAISE EXCEPTION '${code}:`));
    }
  });
  it('the audit row carries both identities', () => {
    expect(sql).toMatch(/'verification\.decided'[\s\S]{0,300}'recorded_on_behalf_of', p_on_behalf_of/);
  });
  it('the contractor-cannot-verify rule is enforced on this table too', () => {
    expect(sql).toMatch(/CREATE TRIGGER stage_verifications_guard\s+BEFORE INSERT OR UPDATE ON public\.stage_verifications/);
  });
});

describe('verified means visited', () => {
  it('a CHECK forbids a verified decision without visited_at; other decisions are free of it', () => {
    expect(sql).toMatch(/CONSTRAINT stage_verifications_verified_means_visited\s+CHECK \(decision <> 'verified' OR visited_at IS NOT NULL\)/);
  });
  it('the RPC names the refusal before the UPDATE, whoever the actor is', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.record_verification'), sql.indexOf('FUNCTION public.approve_stage'));
    const check = fn.indexOf("RAISE EXCEPTION 'visit_required:");
    const update = fn.indexOf('UPDATE public.stage_verifications');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(update);
    // Not inside the actor branches: the rule applies to the verifier and to on-behalf alike.
    expect(fn.slice(check - 200, check)).not.toMatch(/IF v_actor = v\.verifier_id|ELSIF public\.is_admin\(\)/);
  });
});

describe('concurrent transitions serialise', () => {
  it('approve_stage locks the stage row before reading its state', () => {
    // Proven with two sessions: the second admin blocked, then got wrong_state.
    expect(sql).toMatch(/SELECT \* INTO v_stage FROM public\.project_stages WHERE id = p_stage FOR UPDATE;/);
    const fn = sql.slice(sql.indexOf('FUNCTION public.approve_stage'));
    expect(fn.indexOf('FOR UPDATE')).toBeLessThan(fn.indexOf("RAISE EXCEPTION 'wrong_state:"));
  });
  it('record_verification locks the verification row', () => {
    expect(sql).toMatch(/SELECT \* INTO v FROM public\.stage_verifications WHERE id = p_verification FOR UPDATE;/);
  });
});

describe('one open request per stage, admin-selected', () => {
  it('partial unique on pending', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS stage_verifications_one_pending_per_stage\s+ON public\.stage_verifications \(stage_id\) WHERE decision = 'pending'/);
  });
  it('request_verification requires an assigned verifier and a pending_review stage', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'not_assigned:/);
    expect(sql).toMatch(/RAISE EXCEPTION 'wrong_state:/);
    expect(sql).toMatch(/RAISE EXCEPTION 'not_required:/);
  });
});

describe('the client no longer writes the transition', () => {
  it('both approval paths call approve_stage() and neither sets status = complete itself', () => {
    expect(approvals).toMatch(/await approveStageRpc\(stageId\)/g);
    expect((approvals.match(/approveStageRpc\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // No client-side completion of a stage remains in approvals.ts.
    expect(approvals).not.toMatch(/from\('project_stages'\)\s*\.update\(\{\s*status:\s*'complete'/);
  });
  it('the audit row for approval is no longer inserted from the client', () => {
    expect(approvals).not.toMatch(/action:\s*'stage_approved_by_admin'/);
    expect(approvals).not.toMatch(/action:\s*'stage_approved'/);
  });
});
