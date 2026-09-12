import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 086 is mostly RLS, and RLS is where a mistake is invisible: a stacked policy
 * quietly widens access, a dropped one quietly removes it, and neither shows up in the
 * UI. The behaviour was proven on a local Postgres before this shipped; these pin the
 * SHAPE so a later edit cannot silently undo the decisions in
 * docs/groundwork-admin/04-implementation-plan.md §7.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const sql  = readFileSync(join(ROOT, 'supabase/migrations/086_verifiers.sql'), 'utf8');

const STAGE_TABLES = ['projects', 'project_stages', 'project_substages', 'project_documents'];

describe('086 replaces the two-arm SELECT policies with one member policy per table', () => {
  it.each(STAGE_TABLES)('%s gets exactly one member_select policy', table => {
    const short = table.replace('project_', '');
    const creates = sql.match(new RegExp(`CREATE POLICY "member_select_${short}"\\s+ON public\\.${table} FOR SELECT`, 'g')) ?? [];
    expect(creates, `one member SELECT policy on ${table}`).toHaveLength(1);
  });

  it('drops the owner FOR ALL policies rather than leaving a second SELECT path', () => {
    for (const name of ['owner_all_stages', 'owner_all_substages', 'owner_all_documents', 'owner_select_projects']) {
      expect(sql, `${name} must be dropped`).toMatch(new RegExp(`DROP POLICY IF EXISTS "${name}"`));
    }
  });

  it('drops the contractor SELECT policies it subsumes', () => {
    for (const name of ['contractors_select_stages', 'contractors_select_substages', 'contractors_select_invited_projects']) {
      expect(sql, `${name} must be dropped`).toMatch(new RegExp(`DROP POLICY IF EXISTS "${name}"`));
    }
  });

  it('keeps owner writes — approveStage still runs as the owner until 087', () => {
    for (const t of ['stages', 'substages', 'documents']) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY "owner_update_${t}"`));
      expect(sql).toMatch(new RegExp(`CREATE POLICY "owner_insert_${t}"`));
    }
  });

  it('leaves the admin SELECT policies and contractors_update_evidence alone', () => {
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "admin_select_all_/);
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "contractors_update_evidence"/);
  });
});

describe('086 enforces the two rules in the database', () => {
  it('a contractor on the project cannot be its verifier — a trigger, not a UI check', () => {
    expect(sql).toMatch(/is_contractor_on\(NEW\.project_id, NEW\.user_id\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'contractor_cannot_verify:/);
    expect(sql).toMatch(/CREATE TRIGGER project_verifiers_guard\s+BEFORE INSERT OR UPDATE ON public\.project_verifiers/);
  });

  it('assignments cannot be written from the browser', () => {
    // RLS on, and no INSERT/UPDATE/DELETE policy for authenticated on the table.
    expect(sql).toMatch(/ALTER TABLE public\.project_verifiers ENABLE ROW LEVEL SECURITY/);
    const section = sql.slice(sql.indexOf('ENABLE ROW LEVEL SECURITY', sql.indexOf('project_verifiers (')));
    const policies = section.match(/CREATE POLICY "[^"]+"\s+ON public\.project_verifiers FOR (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p, 'only SELECT policies on project_verifiers').toMatch(/FOR SELECT$/);
  });

  it('every RPC re-checks the admin itself, and is revoked from anon', () => {
    for (const fn of ['assign_verifier', 'remove_verifier']) {
      expect(sql).toMatch(new RegExp(`FUNCTION public\\.${fn}[\\s\\S]{0,400}IF NOT public\\.is_admin\\(\\) THEN`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon`));
    }
  });
});

describe('086 introduces none of the forbidden state', () => {
  it('no lifecycle, eligibility, health or action-center columns or tables', () => {
    expect(sql).not.toMatch(/lifecycle_status|eligib|health_band|action_center/i);
  });

  it('does not widen project_stages.status', () => {
    expect(sql).not.toMatch(/project_stages[\s\S]{0,200}status[\s\S]{0,40}CHECK/);
  });

  it('project_member() is created after the table it reads', () => {
    // LANGUAGE sql functions are validated at CREATE; the first draft failed on this.
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS public.project_verifiers'))
      .toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION public.project_member'));
  });
});
