import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 092 was proven on a local Postgres with a Supabase-shaped storage.objects (generated
 * path_tokens, RLS, today's owner/contractor policies) over 084→091: before, an admin and
 * an assigned verifier saw no file at all; after, admin sees every evidence/document
 * object, the verifier and the contractor see their project's, owners are unchanged, a
 * stranger and anon see nothing, a stray non-uuid path raises no error, and INSERT/DELETE
 * on the buckets are still refused for staff. These pin the SHAPE.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const sql = readFileSync(join(ROOT, 'supabase/migrations/092_storage_member_read.sql'), 'utf8');
const ddl = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('092: sight for staff and members, nothing else', () => {
  it('adds exactly two policies, both SELECT, on storage.objects', () => {
    const policies = ddl.match(/CREATE POLICY "[^"]+"\s+ON storage\.objects FOR (\w+)/g) ?? [];
    expect(policies.length).toBe(2);
    for (const p of policies) expect(p).toMatch(/FOR SELECT$/);
    expect(ddl).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });
  it('the arm is is_admin() OR project_member(path_tokens[1]) on each bucket, and only those buckets', () => {
    for (const b of ['evidence', 'documents'])
      expect(ddl).toMatch(new RegExp(`bucket_id = '${b}'\\s+AND \\(public\\.is_admin\\(\\) OR public\\.project_member\\(public\\.try_uuid\\(path_tokens\\[1\\]\\)\\)\\)`));
    expect(ddl).not.toMatch(/bucket_id = '(contractor-docs|certificates|agent-outputs)'/);
  });
  it('does not drop or replace the owner/contractor policies', () => {
    expect(ddl).not.toMatch(/DROP POLICY IF EXISTS "(evidence_read|documents_read|contractor_evidence_read|evidence_delete|documents_delete)"/);
  });
  it('the uuid cast cannot throw on a stray path', () => {
    expect(ddl).toMatch(/FUNCTION public\.try_uuid\(p text\)\s+RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT/);
    expect(ddl).toMatch(/EXCEPTION WHEN invalid_text_representation THEN\s+RETURN NULL;/);
  });
  it('follows 028: each policy in a DO block that reports instead of failing when the editor lacks storage privilege', () => {
    expect((ddl.match(/EXCEPTION WHEN insufficient_privilege OR undefined_table THEN/g) ?? []).length).toBe(2);
    expect(sql).toMatch(/Storage > evidence\s+> Policies > New policy/);
  });
  it('touches no public table, no migration 084–091 object', () => {
    expect(ddl).not.toMatch(/ALTER TABLE public\.|CREATE TABLE|ON public\.\w+ FOR/);
  });
});
