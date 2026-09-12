import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 089's behaviour was proven on a local Postgres with 084→089 applied over history shaped
 * like production's (004-era browser rows, a 029 row, 060 rows, 086/087/088 rows written by
 * the old log_activity): seven rows survived byte-for-byte, four were enriched, three were
 * left alone, a re-run changed nothing. These pin the SHAPE: one activity table, a
 * conservative backfill, no browser write path, and the readers that predate 089 still
 * finding what they read.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql       = read('supabase/migrations/089_activity_model.sql');
const ddl       = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const approvals = read('src/lib/supabase/approvals.ts');
const overview  = read('src/lib/supabase/admin-overview.ts');
const provision = read('api/_handlers/admin-provision-user.ts');
const m084      = read('supabase/migrations/084_admin_project_activity.sql');
const en        = read('src/lib/i18n/en.ts');
const fr        = read('src/lib/i18n/fr.ts');

describe('one activity source', () => {
  it('creates no table — project_audit_log is extended, not replaced', () => {
    expect(ddl).not.toMatch(/CREATE TABLE/i);
    expect(ddl).toMatch(/ALTER TABLE public\.project_audit_log\s+ADD COLUMN IF NOT EXISTS entity_type text,\s+ADD COLUMN IF NOT EXISTS entity_id\s+uuid,\s+ADD COLUMN IF NOT EXISTS person_id\s+uuid;/);
    expect(ddl).toMatch(/ALTER COLUMN project_id DROP NOT NULL/);
  });
  it('stores no state: no lifecycle, eligibility, cached summary or action-center columns', () => {
    expect(ddl).not.toMatch(/lifecycle|eligib|health_band|action_center|summary|_count\b/i);
  });
  it('person_id carries no foreign key — the row outlives the account (069 rule)', () => {
    expect(ddl).not.toMatch(/person_id\s+uuid\s+REFERENCES/);
    expect(ddl).toMatch(/CHECK \(project_id IS NOT NULL OR person_id IS NOT NULL\)/);
    expect(ddl).toMatch(/CHECK \(\(entity_type IS NULL\) = \(entity_id IS NULL\)\)/);
  });
});

describe('backfill is conservative and idempotent', () => {
  it('promotes only what 086’s writer put in details, and only into empty columns', () => {
    const promote = ddl.slice(ddl.indexOf("SET entity_type = a.details->>'entity_type'"), ddl.indexOf("-- (a')") > 0 ? ddl.indexOf("-- (a')") : undefined);
    expect(promote).toMatch(/WHERE a\.entity_type IS NULL\s+AND a\.details \? 'entity_type'/);
    expect(promote).toMatch(/\(a\.details->>'entity_id'\) ~\* '\^\[0-9a-f\]\{8\}/);
  });
  it('maps stage rows from stage_id and nothing else — no mapping for tier_changed or admin_assigned_contractor history', () => {
    expect(ddl).toMatch(/SET entity_type = 'project_stage', entity_id = stage_id\s+WHERE entity_type IS NULL AND stage_id IS NOT NULL/);
    const backfill = ddl.slice(ddl.indexOf('3. Backfill'), ddl.indexOf('4. Browser writes end'));
    expect(backfill).not.toMatch(/tier_changed|admin_assigned_contractor|'project'/);
  });
  it('never rewrites details or deletes rows', () => {
    expect(ddl).not.toMatch(/SET details/);
    expect(ddl).not.toMatch(/DELETE FROM public\.project_audit_log/);
  });
});

describe('the browser no longer writes audit rows', () => {
  it('drops both INSERT policies and adds no write policy', () => {
    expect(ddl).toMatch(/DROP POLICY IF EXISTS "owner_insert_audit_log"/);
    expect(ddl).toMatch(/DROP POLICY IF EXISTS "admin_insert_audit_log"/);
    expect(ddl).not.toMatch(/CREATE POLICY/);
  });
  it('log_activity keeps its 086 signature, is not callable from a client, and writes the columns', () => {
    expect(ddl).toMatch(/FUNCTION public\.log_activity\(\s+p_project\s+uuid,\s+p_action\s+text,\s+p_entity_type text\s+DEFAULT NULL,\s+p_entity_id\s+uuid\s+DEFAULT NULL,\s+p_person\s+uuid\s+DEFAULT NULL,\s+p_details\s+jsonb\s+DEFAULT '\{\}'::jsonb\s+\)/);
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.log_activity\(uuid, text, text, uuid, uuid, jsonb\) FROM PUBLIC, anon, authenticated;/);
    expect(ddl).toMatch(/\(project_id, stage_id, action, actor_id, details, entity_type, entity_id, person_id\)/);
    expect(ddl).toMatch(/CASE WHEN p_entity_type = 'project_stage' THEN p_entity_id END/);
  });
  it('the two writers that were still in approvals.ts call RPCs; the direct insert survives only as the not-yet-applied fallback', () => {
    expect(approvals).toMatch(/await submitStageForReview\(stageId\)/);
    expect(approvals).toMatch(/await requestRework\(stageId, reason\)/);
    const inserts = approvals.match(/from\('project_audit_log'\)\.insert\(/g) ?? [];
    expect(inserts.length).toBe(2);
    for (const m of approvals.matchAll(/from\('project_audit_log'\)\.insert\(/g)) {
      const before = approvals.slice(Math.max(0, m.index! - 700), m.index);
      expect(before).toMatch(/if \(!isMissingRpc\(err\)\) throw err;/);
    }
  });
  it('the RPCs keep the historical action names 084 and the dictionaries key on', () => {
    expect(ddl).toMatch(/'stage_submitted_for_review', 'project_stage', p_stage/);
    expect(ddl).toMatch(/'rework_requested', 'project_stage', p_stage/);
    expect(m084).toMatch(/'stage_submitted_for_review'/);
    expect(m084).toMatch(/'rework_requested'/);
    for (const dict of [en, fr]) {
      expect(dict).toMatch(/stage_submitted_for_review:/);
      expect(dict).toMatch(/rework_requested:/);
      expect(dict).toMatch(/client_provisioned:/);
      expect(dict).toMatch(/site_update_submitted:/);
    }
  });
  it('the RPCs are granted to authenticated and revoked from anon; each locks the stage', () => {
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.submit_stage_for_review\(uuid\)\s+FROM PUBLIC, anon;/);
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.request_rework\(uuid, text\)\s+FROM PUBLIC, anon;/);
    expect((ddl.match(/FROM public\.project_stages WHERE id = p_stage FOR UPDATE/g) ?? []).length).toBe(2);
    expect(ddl).toMatch(/IF NOT public\.is_admin\(\) THEN RAISE EXCEPTION 'not_admin:/);
    expect(ddl).toMatch(/RAISE EXCEPTION 'not_owner:/);
  });
});

describe('readers and the one server-side writer', () => {
  it('the overview reads the new columns and falls back to the pre-089 select on 42703', () => {
    expect(overview).toMatch(/person_id, entity_type, created_at/);
    expect(overview).toMatch(/wide\.error\.code !== '42703'/);
    expect(overview).toMatch(/personName:\s+owners\.get\(str\(r\.person_id\)\)/);
  });
  it('provisioning writes a person-level row with the verified caller as actor, fail-soft', () => {
    expect(provision).toMatch(/action:\s+'client\.provisioned'/);
    expect(provision).toMatch(/project_id:\s+null/);
    expect(provision).toMatch(/actor_id:\s+caller\.id/);
    expect(provision).toMatch(/person_id:\s+userId/);
    expect(provision).toMatch(/if \(auditErr\) console\.error/);
  });
  it('admin_assign_contractor logs through log_activity with the invite as entity', () => {
    expect(ddl).toMatch(/log_activity\(p_project_id, 'admin_assigned_contractor', 'contractor_invite', v_invite_id, v_person,/);
  });
});
