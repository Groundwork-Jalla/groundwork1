#!/usr/bin/env node
/**
 * Read a drawing and say what it is — from the terminal, against the real file.
 *
 *   npm run plan:read -- path/to/drawing.pdf            one file
 *   npm run plan:read -- --project <uuid>               every document on a project
 *   npm run plan:read -- --category other               every document filed as `other`
 *   npm run plan:read -- --all                          every document in the bucket
 *   npm run plan:read -- <file> --sql                   print the backfill SQL
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────
 * Two separate failures, both reported by the people using the platform:
 *
 *   1. A contractor uploaded an office plan and the system called the project
 *      Residential · Single Family. The drawing said otherwise, in its own labels, and
 *      nothing read it. (7 Nov 2026)
 *   2. "The contractor has uploaded their bill of quantities and floor plan" is the
 *      shared definition of a qualified project, and nothing could tell a floor plan
 *      from any other attachment. Of the eleven drawings in production on 9 Nov 2026,
 *      filed by contractors as plans, SEVEN were not floor plans.
 *
 * Both come down to the same thing: no one could read a drawing without opening it by
 * hand. This is the tool that reads it, on the real bytes, with `poppler` doing the
 * page work — the same `pdftotext` the browser extractor leans on, but runnable over
 * production without a browser.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────────
 * Write to the database. It prints what it found, and `--sql` prints the statements a
 * migration would carry. A category on a document is a claim about a contractor's
 * upload; it gets changed in a reviewed migration, never by a script someone ran once.
 *
 * ── REQUIREMENTS ────────────────────────────────────────────────────────────────────
 * poppler-utils (`pdftotext`, `pdfinfo`, `pdftoppm`). Already present on this machine
 * and on any Debian image: `apt-get install -y poppler-utils`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = new URL('..', import.meta.url).pathname;

/**
 * The classifier itself is TypeScript the app ships. Imported, never re-implemented —
 * a second copy of these rules is a second set of answers. Node strips the types.
 */
async function loadClassifier() {
  return import(pathToFileURL(join(REPO, 'src/lib/documents/plan-sheet.ts')).href);
}

function have(bin) {
  try { execFileSync('which', [bin], { stdio: 'pipe' }); return true; } catch { return false; }
}

/** Every page's text layer, in page order. One entry per sheet. */
function pageTexts(path) {
  let pages = 1;
  try {
    const info = execFileSync('pdfinfo', [path], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 1);
  } catch { /* not a PDF, or no text layer — handled below */ }
  const out = [];
  for (let p = 1; p <= pages; p++) {
    try {
      out.push(execFileSync('pdftotext', ['-f', String(p), '-l', String(p), path, '-'],
        { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
    } catch { out.push(''); }
  }
  return out;
}

const PDF = /\.pdf$/i;
const IMAGE = /\.(?:png|jpe?g|webp|gif)$/i;

/**
 * Read one file.
 *
 * An image has no text layer at all, and neither does a PDF that was scanned or
 * exported as a flat raster. Both are reported as UNREADABLE rather than as "not a
 * floor plan" — the difference is the whole point. A drawing we could not read is a
 * drawing for the vision reader (`api/_handlers/read-floor-plan.ts`) or for a person,
 * and calling it "not a plan" would be inventing an answer.
 */
async function readFile(path, { readPlanDocument }) {
  const name = basename(path);
  if (IMAGE.test(name)) {
    return { name, path, verdict: 'unreadable', reason: 'image — no text layer; needs the vision read', sheets: [], contains: [] };
  }
  if (!PDF.test(name)) {
    return { name, path, verdict: 'not-a-drawing', reason: `${name.split('.').pop()} is not a drawing format`, sheets: [], contains: [] };
  }
  const texts = pageTexts(path);
  if (!texts.some(t => t.trim())) {
    return { name, path, verdict: 'unreadable', reason: 'no text layer (scanned or flattened); needs the vision read', sheets: [], contains: [] };
  }
  const reading = readPlanDocument(texts);
  return {
    name, path,
    verdict: reading.isFloorPlan ? 'floor_plan' : 'not-a-floor-plan',
    pages: texts.length,
    sheets: reading.sheets,
    contains: reading.contains,
    basis: reading.basis,
  };
}

/** Pull the documents this run is about out of Supabase, into a scratch directory. */
async function fetchDocuments({ project, category, all }) {
  const envPath = join(REPO, '.env.local');
  if (!existsSync(envPath)) throw new Error('.env.local not found — needed for SUPABASE_SERVICE_ROLE_KEY');
  const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(REPO, 'package.json'));
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  let q = db.from('project_documents').select('id,project_id,file_name,file_path,category').order('created_at');
  if (project) q = q.eq('project_id', project);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!all && !project && !category) throw new Error('pass --project, --category or --all');

  const dir = mkdtempSync(join(tmpdir(), 'gw-docs-'));
  const rows = [];
  for (const d of data) {
    const target = join(dir, `${d.id}__${d.file_name.replace(/[^\w.\-]+/g, '_')}`);
    const { data: file, error: err } = await db.storage.from('documents').download(d.file_path);
    if (err || !file) { rows.push({ ...d, missing: true }); continue; }
    writeFileSync(target, Buffer.from(await file.arrayBuffer()));
    rows.push({ ...d, local: target });
  }
  return { rows, dir };
}

function print(row, doc) {
  const mark = row.verdict === 'floor_plan' ? '  FLOOR PLAN'
    : row.verdict === 'unreadable' ? '  UNREADABLE'
    : '  not a floor plan';
  console.log(`\n${doc?.id ? doc.id.slice(0, 8) + '  ' : ''}${row.name}`);
  console.log(`${mark}${row.pages ? `   (${row.pages} sheet${row.pages > 1 ? 's' : ''})` : ''}`);
  if (row.reason) console.log(`  reason: ${row.reason}`);
  if (row.contains?.length) console.log(`  contains: ${row.contains.join(', ')}`);
  if (row.basis?.length) console.log(`  because the sheet says: ${row.basis.join(' / ')}`);
  if (row.sheets?.length > 1) {
    for (const [i, s] of row.sheets.entries()) {
      console.log(`    p${String(i + 1).padStart(2)}  ${s.kind}${s.basis.length ? `  — ${s.basis.join(' / ')}` : ''}`);
    }
  }
  if (doc && row.verdict === 'floor_plan' && doc.category !== 'floor_plan') {
    console.log(`  MISFILED: stored as '${doc.category}'`);
  }
  if (doc && row.verdict === 'not-a-floor-plan' && doc.category === 'floor_plan') {
    console.log(`  MISFILED: stored as 'floor_plan'`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const has = n => argv.includes(n);

  for (const bin of ['pdftotext', 'pdfinfo']) {
    if (!have(bin)) { console.error(`missing ${bin} — apt-get install -y poppler-utils`); process.exit(2); }
  }
  const mod = await loadClassifier();

  const files = argv.filter(a => !a.startsWith('--') && existsSync(a));
  const wantsDb = has('--all') || flag('--project') || flag('--category');

  if (!files.length && !wantsDb) {
    console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 11).join('\n').replace(/^ \* ?/gm, ''));
    process.exit(1);
  }

  const results = [];
  for (const f of files) {
    const row = await readFile(f, mod);
    results.push({ row });
    print(row, null);
  }

  if (wantsDb) {
    const { rows, dir } = await fetchDocuments({
      project: flag('--project'), category: flag('--category'), all: has('--all'),
    });
    try {
      for (const doc of rows) {
        if (doc.missing) { console.log(`\n${doc.id.slice(0, 8)}  ${doc.file_name}\n  MISSING from storage`); continue; }
        const row = await readFile(doc.local, mod);
        results.push({ row, doc });
        print(row, doc);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  const plans = results.filter(r => r.row.verdict === 'floor_plan');
  const unread = results.filter(r => r.row.verdict === 'unreadable');
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${results.length} read   ${plans.length} floor plan   ` +
    `${results.length - plans.length - unread.length} not   ${unread.length} unreadable`);

  if (has('--sql')) {
    const moves = results.filter(r => r.doc && r.row.verdict === 'floor_plan' && r.doc.category !== 'floor_plan');
    console.log('\n-- paste into a migration, after 179 adds the category\n');
    for (const m of moves) {
      console.log(`-- ${m.doc.file_name}: ${m.row.basis.join(' / ')}`);
      console.log(`UPDATE public.project_documents SET category = 'floor_plan' WHERE id = '${m.doc.id}';`);
    }
    if (!moves.length) console.log('-- nothing to move');
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1); });
