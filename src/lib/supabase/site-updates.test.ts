import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 088's behaviour was proven on a local Postgres — eleven cases including a failure
 * injected after both writes, which rolled both back. These pin the SHAPE so a later
 * edit cannot turn site_updates into a second evidence system, reopen a browser write to
 * the index, or drop the atomicity.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql      = read('supabase/migrations/088_site_updates.sql');
const upload   = read('src/components/project/EvidenceUpload.tsx');
const approvals = read('src/lib/supabase/approvals.ts');

describe('site_updates is the record, evidence_urls stays the index', () => {
  it('the RPC writes the record AND appends to evidence_urls in one function body', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.submit_site_update'), sql.indexOf('REVOKE ALL ON FUNCTION public.submit_site_update'));
    expect(fn).toMatch(/INSERT INTO public\.site_updates/);
    expect(fn).toMatch(/UPDATE public\.project_substages s\s+SET evidence_urls =/);
  });
  it('never migrates or clears evidence_urls', () => {
    expect(sql).not.toMatch(/evidence_urls\s*=\s*'\[\]'/);
    expect(sql).not.toMatch(/DROP COLUMN[^;]*evidence_urls/);
    expect(sql).not.toMatch(/INSERT INTO public\.site_updates[\s\S]{0,400}FROM public\.project_substages/);
  });
  it('appends deduplicated — a path already in the index is not added again', () => {
    expect(sql).toMatch(/WHERE NOT s\.evidence_urls @> jsonb_build_array\(n\)/);
  });
  it('refuses a path outside the project prefix — the bucket RLS keys on path_tokens[1]', () => {
    expect(sql).toMatch(/split_part\(e, '\/', 1\) <> v_stage\.project_id::text/);
    expect(sql).toMatch(/RAISE EXCEPTION 'path_mismatch:/);
  });
});

describe('who may submit', () => {
  it('owner, contractor, admin — and a verifier is refused by name', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'not_submitter: a verifier/);
    expect(sql).toMatch(/RAISE EXCEPTION 'not_member:/);
  });
  it('the table is RPC-only: RLS on, SELECT policy only', () => {
    const after = sql.slice(sql.indexOf('ALTER TABLE public.site_updates ENABLE ROW LEVEL SECURITY'));
    const policies = after.match(/CREATE POLICY "[^"]+"\s+ON public\.site_updates FOR (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
  });
});

describe('retries and the 087 hook', () => {
  it('a client_ref makes a retry return the existing row', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS site_updates_client_ref_key\s+ON public\.site_updates \(client_ref\) WHERE client_ref IS NOT NULL/);
    expect(sql).toMatch(/SELECT id INTO v_existing FROM public\.site_updates WHERE client_ref = p_client_ref;\s+IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;/);
  });
  it('adds the FK 087 left as a plain uuid', () => {
    expect(sql).toMatch(/ADD CONSTRAINT stage_verifications_site_update_id_fkey\s+FOREIGN KEY \(site_update_id\) REFERENCES public\.site_updates\(id\) ON DELETE SET NULL/);
  });
});

describe('review amendments (12 Sep): substage, concurrency, path types', () => {
  it('evidence without a substage is refused in the RPC — the index has nowhere to go', () => {
    expect(sql).toMatch(/IF jsonb_array_length\(v_paths\) > 0 AND p_substage IS NULL THEN\s+RAISE EXCEPTION 'substage_required:/);
    // Enforced in the RPC, not as a table CHECK: substage_id is ON DELETE SET NULL, and a
    // CHECK would make deleting a substage fail on every historical update.
    expect(sql).not.toMatch(/CHECK \([^)]*substage_id IS NOT NULL/);
    // The refusal comes before the INSERT, so no record is created either.
    const fn = sql.slice(sql.indexOf('FUNCTION public.submit_site_update'));
    expect(fn.indexOf("'substage_required:")).toBeLessThan(fn.indexOf('INSERT INTO public.site_updates'));
  });
  it('two concurrent retries converge on the partial unique index, not on a pre-check', () => {
    // Belt: pre-check. Braces: the INSERT itself arbitrates on the same partial index the
    // unique constraint lives on; the loser reads the winner's id and returns before the
    // index append and the audit row.
    expect(sql).toMatch(/ON CONFLICT \(client_ref\) WHERE client_ref IS NOT NULL DO NOTHING\s+RETURNING id INTO v_id;/);
    const fn = sql.slice(sql.indexOf('FUNCTION public.submit_site_update'));
    const loser = fn.indexOf('IF v_id IS NULL THEN');
    expect(loser).toBeGreaterThan(fn.indexOf('ON CONFLICT (client_ref)'));
    expect(loser).toBeLessThan(fn.indexOf('UPDATE public.project_substages s'));
    expect(loser).toBeLessThan(fn.indexOf("log_activity(v_stage.project_id, 'site_update.submitted'"));
    expect(fn.slice(loser, fn.indexOf('END IF;', loser))).toMatch(/SELECT id INTO v_id FROM public\.site_updates WHERE client_ref = p_client_ref;\s+RETURN v_id;/);
  });
  it('evidence paths must be an array of strings — table CHECK and RPC agree via one helper', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.jsonb_is_string_array\(j jsonb\)/);
    expect(sql).toMatch(/jsonb_typeof\(j\) = 'array'\s+AND NOT EXISTS \(SELECT 1 FROM jsonb_array_elements\(j\) e WHERE jsonb_typeof\(e\) <> 'string'\)/);
    expect(sql).toMatch(/CONSTRAINT site_updates_paths_are_strings\s+CHECK \(public\.jsonb_is_string_array\(evidence_paths\)\)/);
    expect(sql).toMatch(/IF NOT public\.jsonb_is_string_array\(v_paths\) THEN\s+RAISE EXCEPTION 'bad_paths:/);
    // The helper must exist before the table that references it in a CHECK.
    expect(sql.indexOf('FUNCTION public.jsonb_is_string_array')).toBeLessThan(sql.indexOf('CREATE TABLE IF NOT EXISTS public.site_updates'));
  });
});

describe('the browser no longer owns the evidence index', () => {
  it('EvidenceUpload calls the RPC, with the direct write only as the not-yet-applied fallback', () => {
    expect(upload).toMatch(/await submitSiteUpdate\(\{/);
    const rpcAt = upload.indexOf('await submitSiteUpdate(');
    const directAt = upload.indexOf(".update({ evidence_urls: newUrls })", rpcAt);
    expect(directAt).toBeGreaterThan(rpcAt);
    expect(upload.slice(rpcAt, directAt)).toMatch(/isSiteUpdatesUnavailable\(err\)/);
  });
  it('the dead direct writer in approvals.ts is gone', () => {
    expect(approvals).not.toMatch(/export async function updateSubstageEvidenceUrls/);
  });
  it('introduces no stored lifecycle or eligibility state', () => {
    const ddl = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(ddl).not.toMatch(/lifecycle_status|eligib|health_band|action_center/i);
  });
});
