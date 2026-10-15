import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/119_contractor_project_setup_reads.sql'),
  'utf8',
);
const projects = readFileSync(join(ROOT, 'src/lib/supabase/projects.ts'), 'utf8');

describe('contractor-created client project setup reads', () => {
  it('allows only the creator to read an unstarted project belonging to their own client', () => {
    expect(migration).toMatch(/p\.created_by = auth\.uid\(\)/);
    expect(migration).toMatch(/p\.tracking_started_at IS NULL/);
    expect(migration).toMatch(/public\.is_my_clients_project\(p\.id\)/);
    expect(migration).toMatch(
      /CREATE POLICY "contractors_select_own_client_setup_projects"[\s\S]*?ON public\.projects FOR SELECT TO authenticated[\s\S]*?USING \(public\.is_my_client_project_setup\(id\)\)/,
    );
  });

  it('allows reading seeded stages returned before contractor membership is created', () => {
    expect(migration).toMatch(
      /CREATE POLICY "contractors_select_own_client_setup_stages"[\s\S]*?ON public\.project_stages FOR SELECT TO authenticated[\s\S]*?USING \(public\.is_my_client_project_setup\(project_id\)\)/,
    );
    expect(projects).toMatch(/\.from\('projects'\)[\s\S]*?\.insert\([\s\S]*?\.select\(\)\s*\.single/);
    expect(projects).toMatch(/\.from\('project_stages'\)[\s\S]*?\.insert\([\s\S]*?\.select\(\)/);
  });
});
