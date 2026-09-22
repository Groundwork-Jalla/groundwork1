import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ACCEPTED_MIME_TYPES, FILE_ACCEPT_ATTR, MAX_FILE_BYTES, MAX_FILE_MB,
  fileProblem, isSpreadsheet,
} from './accepted-files';

const f = (name: string, type = '', size = 1024) => ({ name, type, size });

describe('fileProblem', () => {
  it('accepts the spreadsheet formats a bill of quantities actually arrives in', () => {
    expect(fileProblem(f('boq.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBeNull();
    expect(fileProblem(f('boq.xls', 'application/vnd.ms-excel'))).toBeNull();
    expect(fileProblem(f('boq.csv', 'text/csv'))).toBeNull();
    expect(fileProblem(f('boq.ods', 'application/vnd.oasis.opendocument.spreadsheet'))).toBeNull();
  });

  it('accepts a spreadsheet whose type the browser does not report', () => {
    // Windows with no Office association sends ''. Refusing this would refuse the
    // exact file this feature exists for.
    expect(fileProblem(f('boq.xlsx', ''))).toBeNull();
    expect(fileProblem(f('BOQ.XLSX', ''))).toBeNull();
  });

  it('accepts a spreadsheet whose type is right but whose name has no extension', () => {
    expect(fileProblem(f('boq', 'application/vnd.ms-excel'))).toBeNull();
  });

  it('still accepts what the wizard took before', () => {
    for (const n of ['quote.pdf', 'quote.doc', 'quote.docx', 'plan.png', 'plan.jpg']) {
      expect(fileProblem(f(n)), n).toBeNull();
    }
  });

  it('refuses what Storage would refuse, rather than failing after the upload', () => {
    expect(fileProblem(f('archive.zip', 'application/zip'))).toBe('type');
    expect(fileProblem(f('script.exe', 'application/x-msdownload'))).toBe('type');
    expect(fileProblem(f('notes.txt', 'text/plain'))).toBe('type');
  });

  it('refuses a file over the bucket ceiling, and allows one exactly at it', () => {
    expect(fileProblem(f('boq.xlsx', '', MAX_FILE_BYTES + 1))).toBe('size');
    expect(fileProblem(f('boq.xlsx', '', MAX_FILE_BYTES))).toBeNull();
  });

  it('reports the type problem first — a wrong type is not fixed by shrinking it', () => {
    expect(fileProblem(f('big.zip', 'application/zip', MAX_FILE_BYTES * 2))).toBe('type');
  });
});

describe('isSpreadsheet', () => {
  it.each(['boq.xlsx', 'boq.xls', 'boq.csv', 'boq.ods'])('%s', n => {
    expect(isSpreadsheet(f(n))).toBe(true);
  });
  it.each(['quote.pdf', 'plan.png', 'notes.docx'])('%s is not', n => {
    expect(isSpreadsheet(f(n))).toBe(false);
  });
});

describe('the rules match the bucket they describe', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const sql = readFileSync(join(ROOT, 'supabase/migrations/096_boq_uploads.sql'), 'utf8');

  it('every accepted MIME type is one migration 096 grants the bucket', () => {
    // A type this module accepts and the bucket refuses is an upload that fails after
    // the person was told it was fine. This is the check that keeps the two in step.
    const granted = [...sql.matchAll(/'([a-z]+\/[A-Za-z0-9.+-]+)'/g)].map(m => m[1]);
    for (const type of ACCEPTED_MIME_TYPES) expect(granted, type).toContain(type);
  });

  it('the bucket ceiling is stated, not invented — 20 MB, as set in migration 011', () => {
    const bucket = readFileSync(join(ROOT, 'supabase/migrations/011_fix_storage_policies.sql'), 'utf8');
    expect(bucket).toMatch(/'documents', 'documents', false,\s*\n?\s*20971520/);
    expect(MAX_FILE_BYTES).toBe(20971520);
    expect(MAX_FILE_MB).toBe(20);
  });

  it('096 keeps boq alongside the categories that already existed', () => {
    expect(sql).toMatch(/CHECK \(category IN \('contract','permit','receipt','invoice','report','site_photo','boq','other'\)\)/);
  });

  it('the accept attribute offers extensions as well as types (Safari reads extensions)', () => {
    expect(FILE_ACCEPT_ATTR).toContain('.xlsx');
    expect(FILE_ACCEPT_ATTR).toContain('.csv');
    expect(FILE_ACCEPT_ATTR).toContain('application/vnd.ms-excel');
  });
});

describe('the screens use these rules', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

  it('the wizard offers the shared list and files the attachment as a BoQ', () => {
    const src = read('src/components/wizard/steps/Step11ConfirmBudget.tsx');
    expect(src).toMatch(/accept=\{FILE_ACCEPT_ATTR\}/);
    expect(src).toMatch(/uploadDocument\(project\.id, ownerId, file, undefined, 'boq'\)/);
    expect(src).not.toMatch(/accept="\.pdf/);
  });

  it('the wizard checks the file when it is picked, not after the project is created', () => {
    const src = read('src/components/wizard/steps/Step11ConfirmBudget.tsx');
    const check = src.indexOf('fileProblem(picked)');
    const create = src.indexOf('await createProject(');
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(src.slice(check, check + 400)).toMatch(/setFile\(null\)/);
  });

  it('a failed attachment is reported instead of swallowed', () => {
    expect(read('src/components/wizard/steps/Step11ConfirmBudget.tsx')).toMatch(/attachment=failed/);
    expect(read('src/app/routes/projects/detail.tsx')).toMatch(/quoteFailed/);
  });

  it('the vault uses the same list and no longer claims 25 MB', () => {
    const src = read('src/components/project/DocumentVault.tsx');
    expect(src).toMatch(/accept=\{FILE_ACCEPT_ATTR\}/);
    expect(src).toMatch(/fileProblem\(file\)/);
    expect(src).not.toMatch(/25 MB/);
    expect(src).toMatch(/'boq'/);
  });
});
