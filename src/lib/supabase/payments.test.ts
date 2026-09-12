import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ineligibilityReason } from './payments';

/**
 * 090's behaviour was proven on a local Postgres with 084→090 applied: every refusal path
 * of authorise_release, staff and provider funding, the projection following the ledger,
 * a duplicate provider event delivered by two sessions at once (one row, one transition,
 * one audit row), two authorisations racing for the same funds (the second refused after
 * the first committed), immutability of money rows, and an idempotent re-apply. These pin
 * the SHAPE: eligibility never stored, one writer for payment_status, RPC-only writes, the
 * SwyChr boundary, and the audit going through 089's log_activity.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql       = read('supabase/migrations/090_payments_ledger.sql');
const ddl       = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const stripTs = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const lifecycle = stripTs(read('src/lib/lifecycle/stage.ts'));
const projects  = read('src/lib/supabase/projects.ts');
const payments  = read('src/lib/supabase/payments.ts');
const clientPay = stripTs(read('src/components/project/ProjectPayments.tsx'));
const en        = read('src/lib/i18n/en.ts');
const fr        = read('src/lib/i18n/fr.ts');

describe('eligibility is derived, authorisation is a row', () => {
  it('no stored eligibility: no eligible state, no flag column, no cache', () => {
    expect(ddl).not.toMatch(/'eligible'/);
    expect(ddl).not.toMatch(/payment_eligible|eligible\s+boolean|lifecycle_status|cached/i);
    expect(ddl).toMatch(/\(direction = 'out' AND state IN \('release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling'\)\)/);
  });
  it('authorise_release recomputes eligibility in SQL under stage + project locks and refuses with a reason', () => {
    const fn = ddl.slice(ddl.indexOf('FUNCTION public.authorise_release'), ddl.indexOf('FUNCTION public.open_reconciliation'));
    expect(fn).toMatch(/FROM public\.project_stages WHERE id = p_stage FOR UPDATE/);
    expect(fn).toMatch(/FROM public\.projects WHERE id = v_stage\.project_id FOR UPDATE/);
    expect(fn).toMatch(/v_reason := public\.stage_release_blocker\(p_stage, p_amount\);\s+IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'not_eligible:%', v_reason;/);
    expect(fn).toMatch(/IF NOT public\.is_admin\(\) THEN RAISE EXCEPTION 'not_admin:/);
    expect(fn).toMatch(/IF NOT public\.is_contractor_on\(v_project\.id, p_beneficiary\) THEN\s+RAISE EXCEPTION 'bad_beneficiary:/);
    expect(fn).toMatch(/RAISE EXCEPTION 'already_authorised:/);
    expect(fn).toMatch(/'out', 'release_authorised', p_amount, 'USD', p_beneficiary, v_actor, now\(\)/);
    expect(fn).toMatch(/log_activity\(v_project\.id, 'payment\.release_authorised', 'payment', v_id, p_beneficiary,/);
  });
  it('the SQL rule and the TypeScript rule are the same four conditions', () => {
    const blocker = ddl.slice(ddl.indexOf('FUNCTION public.stage_release_blocker'), ddl.indexOf('FUNCTION public.confirm_funding'));
    for (const reason of ['on_hold', 'not_complete', 'not_verified', 'over_milestone', 'insufficient_funds']) expect(blocker).toContain(`RETURN '${reason}'`);
    expect(blocker).toMatch(/state IN \('funded', 'reconciled'\)/);
    expect(blocker).toMatch(/direction = 'out' AND state <> 'failed'/);
    expect(lifecycle).toMatch(/export function availableFunds/);
    expect(lifecycle).toMatch(/p\.state === 'funded' \|\| p\.state === 'reconciled'/);
    expect(lifecycle).toMatch(/p\.direction === 'out' && p\.state !== 'failed'/);
    expect(lifecycle).toMatch(/blockers\.push\('awaiting_funding'\)/);
  });
  it('stageLifecycle never reads payment_status', () => {
    expect(lifecycle).not.toMatch(/payment_status/);
  });
});

describe('one ledger, RPC-only', () => {
  it('payments and payment_events have SELECT policies only', () => {
    const policies = ddl.match(/CREATE POLICY "[^"]+" ON public\.(payments|payment_events) FOR (\w+)/g) ?? [];
    expect(policies.length).toBe(4);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
  });
  it('a state changes only inside the four writers (transaction-local flag), and an out row is born authorised', () => {
    expect(ddl).toMatch(/IF current_setting\('app\.payments_write', true\) IS DISTINCT FROM 'on' THEN\s+RAISE EXCEPTION 'payments_via_rpc:/);
    expect((ddl.match(/set_config\('app\.payments_write', 'on', true\)/g) ?? []).length).toBe(4);
    expect(ddl).toMatch(/IF NEW\.direction = 'out' AND NEW\.state <> 'release_authorised' THEN/);
  });
  it('transitions are exactly the approved graph', () => {
    expect(ddl).toMatch(/\(\('expected','funded'\), \('funded','reconciled'\)\)/);
    expect(ddl).toMatch(/\('release_authorised','initiated'\), \('initiated','disbursed'\),\s+\('initiated','failed'\), \('failed','reconciling'\),\s+\('reconciling','disbursed'\), \('reconciling','failed'\)/);
  });
  it('money rows are immutable and never deleted alone; the project cascade (069) still works', () => {
    expect(ddl).toMatch(/immutable: amount is fixed once money is received or authorised/);
    expect(ddl).toMatch(/immutable: authorisation is a record, not a field/);
    expect(ddl).toMatch(/IF OLD\.state <> 'expected' AND pg_trigger_depth\(\) <= 1 THEN/);
  });
  it('one live release per stage is a unique index, not a check in code', () => {
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_release_per_stage\s+ON public\.payments \(stage_id\) WHERE direction = 'out' AND state <> 'failed'/);
  });
  it('grants: admin acts go to authenticated (RPC re-checks is_admin); provider path to service_role only', () => {
    expect(ddl).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.confirm_funding\(uuid, text\)\s+TO authenticated/);
    expect(ddl).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.authorise_release\(uuid, numeric, uuid, text\)\s+TO authenticated/);
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.record_payment_event\(text, text, text, jsonb, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(ddl).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.record_payment_event\(text, text, text, jsonb, uuid, text\) TO service_role/);
    expect(ddl).toMatch(/REVOKE ALL ON FUNCTION public\.stage_release_blocker\(uuid, numeric\)\s+FROM authenticated/);
  });
});

describe('funding: staff confirmation is not provider confirmation', () => {
  it('staff_confirmed requires confirmed_by, confirmed_at and provider IS NULL; provider requires a provider', () => {
    expect(ddl).toMatch(/funding_source IS DISTINCT FROM 'staff_confirmed'\s+OR \(confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND provider IS NULL\)/);
    expect(ddl).toMatch(/funding_source IS DISTINCT FROM 'provider' OR provider IS NOT NULL/);
    expect(ddl).toMatch(/SET state = 'funded', funding_source = 'staff_confirmed',\s+confirmed_by = v_actor, confirmed_at = now\(\)/);
  });
  it('there is no staff path for disbursement — only the provider moves an out row', () => {
    const humanFns = ddl.slice(ddl.indexOf('FUNCTION public.confirm_funding'), ddl.indexOf('FUNCTION public.record_payment_event'));
    expect(humanFns).not.toMatch(/'disbursed'|'initiated'/);
  });
  it('the expected tranche is seeded by trigger from the milestone and backfilled without inventing funded rows', () => {
    expect(ddl).toMatch(/CREATE TRIGGER stages_seed_expected_funding AFTER INSERT OR UPDATE OF payment_milestone_usd ON public\.project_stages/);
    const backfill = ddl.slice(ddl.indexOf('INSERT INTO public.payments (project_id, stage_id, direction, state, amount, currency)\nSELECT'), ddl.indexOf('CREATE OR REPLACE FUNCTION public.stage_release_blocker'));
    expect(backfill).toContain("'in', 'expected'");
    expect(backfill).not.toMatch(/'funded'/);
  });
});

describe('idempotency: (provider, provider_event_id) arbitrates', () => {
  it('unique key at the database, ON CONFLICT DO NOTHING, transition only when the insert returned a row', () => {
    expect(ddl).toMatch(/CONSTRAINT payment_events_provider_event_key UNIQUE \(provider, provider_event_id\)/);
    const fn = ddl.slice(ddl.indexOf('FUNCTION public.record_payment_event'), ddl.indexOf('REVOKE ALL ON FUNCTION public.confirm_funding'));
    expect(fn).toMatch(/ON CONFLICT \(provider, provider_event_id\) DO NOTHING\s+RETURNING id INTO v_event;\s+IF v_event IS NULL THEN RETURN NULL; END IF;/);
    expect(fn).toMatch(/FOR UPDATE/);
    expect(fn).toMatch(/outcome = 'unmatched'/);
    expect(fn).toMatch(/'illegal_transition'/);
  });
  it('a provider event never fabricates a payment — unmatched events are stored and stop', () => {
    const fn = ddl.slice(ddl.indexOf('FUNCTION public.record_payment_event'));
    expect(fn).not.toMatch(/INSERT INTO public\.payments/);
  });
});

describe('payment_status is a legacy projection with one writer', () => {
  it('projects incoming funding (paid ⇔ funded ≥ milestone), not disbursement', () => {
    expect(ddl).toMatch(/WHERE direction = 'in' AND state IN \('funded', 'reconciled'\) GROUP BY stage_id/);
    expect(ddl).toMatch(/COALESCE\(f\.total, 0\) >= s\.payment_milestone_usd THEN 'paid'/);
    expect(ddl).toMatch(/COALESCE\(f\.total, 0\) > 0 THEN 'partial'/);
  });
  it('a stage with no milestone owes nothing and projects as paid — seeded, re-priced, and backfilled once', () => {
    expect(ddl).toMatch(/WHEN s\.payment_milestone_usd IS NULL OR s\.payment_milestone_usd <= 0 THEN 'paid'/);
    // Seed trigger: $0 → withdraw the plan, project paid; $0 → positive → project again (unpaid until funded).
    expect(ddl).toMatch(/UPDATE public\.project_stages SET payment_status = 'paid' WHERE id = NEW\.id AND payment_status IS DISTINCT FROM 'paid'/);
    expect(ddl).toMatch(/IF TG_OP = 'UPDATE' AND COALESCE\(OLD\.payment_milestone_usd, 0\) <= 0 THEN/);
    // One-time backfill under the projection flag, session-level so it survives statement boundaries.
    expect(ddl).toMatch(/set_config\('app\.payments_projection', 'on', false\)[\s\S]*?UPDATE public\.project_stages\s+SET payment_status = 'paid'\s+WHERE COALESCE\(payment_milestone_usd, 0\) <= 0 AND payment_status IS DISTINCT FROM 'paid'/);
    expect(ddl).toMatch(/set_config\('app\.payments_projection', 'off', false\)/);
  });
  it('re-pricing never duplicates or loses a funded tranche: one INSERT path (no row yet), funded rows only re-project', () => {
    // Proven locally: funded $500 → $0 → $500 → $700 → $300 → $0 → $700 kept one ledger row
    // (paid, paid, paid, partial, paid, partial) and wrote funding.received exactly once.
    const seed = ddl.slice(ddl.indexOf('FUNCTION public.stages_seed_expected_funding'), ddl.indexOf('CREATE TRIGGER stages_seed_expected_funding'));
    expect((seed.match(/INSERT INTO public\.payments/g) ?? []).length).toBe(1);
    expect(seed).toMatch(/IF NOT FOUND THEN\s+INSERT INTO public\.payments/);
    expect(seed).toMatch(/ELSIF v_existing\.state IN \('funded', 'reconciled'\) AND TG_OP = 'UPDATE' THEN/);
    expect(seed).toMatch(/IF FOUND AND v_existing\.state = 'expected' THEN DELETE FROM public\.payments/);
    expect(seed).not.toMatch(/DELETE FROM public\.payments WHERE id = v_existing\.id;\s*END IF;\s*PERFORM[\s\S]*?state = 'funded'/);
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS payments_one_tranche_per_stage\s+ON public\.payments \(stage_id\) WHERE direction = 'in'/);
  });
  it('the guard refuses every write that is not the projection', () => {
    expect(ddl).toMatch(/current_setting\('app\.payments_projection', true\) IS DISTINCT FROM 'on' THEN\s+RAISE EXCEPTION 'payment_status_derived:/);
    expect(ddl).toMatch(/CREATE TRIGGER stages_guard_payment_status BEFORE UPDATE OF payment_status ON public\.project_stages/);
  });
  it('seeding an expected row does not touch a hand-set flag; only received money does', () => {
    expect(ddl).toMatch(/IF \(TG_OP = 'DELETE' OR NEW\.state NOT IN \('funded', 'reconciled'\)\)\s+AND \(TG_OP = 'INSERT' OR OLD\.state NOT IN \('funded', 'reconciled'\)\) THEN\s+RETURN NULL;/);
  });
  it('the manual writer and both toggles are gone from the app', () => {
    expect(projects).not.toMatch(/export async function updatePaymentStatus/);
    expect(clientPay).not.toMatch(/updatePaymentStatus|payment_status/);
    expect(clientPay).toMatch(/notifyAdmins\(\s*'funding_reported'/);
    expect(() => read('src/components/project/PaymentsTab.tsx')).toThrow();
  });
  it('the column is documented as a projection to be retired', () => {
    expect(ddl).toMatch(/COMMENT ON COLUMN public\.project_stages\.payment_status IS\s+'LEGACY PROJECTION/);
  });
});

describe('the SwyChr boundary and the audit', () => {
  it('provider columns are provisional and no provider transaction is fabricated', () => {
    expect((ddl.match(/PROVISIONAL until the SwyChr contract is known/g) ?? []).length).toBe(4);
    expect(ddl).not.toMatch(/swychr\.com|api\.swychr|https?:\/\//i);
  });
  it('every transition audits through 089’s log_activity with entity payment; no financial activity table', () => {
    expect((ddl.match(/log_activity\(/g) ?? []).length).toBe(4); // confirm, authorise, reconcile, provider event
    expect(ddl).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.(payment_activit|financial_|ledger_events)/);
    const tables = ddl.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g) ?? [];
    expect(tables).toEqual(['CREATE TABLE IF NOT EXISTS public.payments', 'CREATE TABLE IF NOT EXISTS public.payment_events']);
  });
  it('the client module writes nothing directly and translates the refusal reason', () => {
    expect(payments).not.toMatch(/from\('payments'\)\s*\.(insert|update|delete|upsert)/);
    expect(payments).toMatch(/supabase\.rpc\('confirm_funding'/);
    expect(payments).toMatch(/supabase\.rpc\('authorise_release'/);
    expect(ineligibilityReason({ message: 'not_eligible:insufficient_funds' })).toBe('insufficient_funds');
    expect(ineligibilityReason({ message: 'not_admin: nope' })).toBeNull();
  });
  it('both dictionaries carry the ledger states and refusal reasons', () => {
    for (const d of [en, fr]) {
      for (const k of ['expected', 'funded', 'reconciled', 'release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling']) expect(d).toMatch(new RegExp(`\\b${k}:`));
      for (const k of ['not_complete', 'not_verified', 'over_milestone', 'insufficient_funds', 'on_hold', 'bad_beneficiary', 'already_authorised']) expect(d).toMatch(new RegExp(`\\b${k}:`));
    }
  });
});
