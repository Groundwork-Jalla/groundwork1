import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The client and the contractor see the same project, so they see the same documents.
 *
 * Favour, 11 Nov 2026, on a call with Philip looking at the contractor's tab: "the
 * document part is from contractors and i want the client document view to look the
 * same as the contractor document view".
 *
 * They were two screens. The contractor had search, chips that count what the search
 * left, and three groups — the build's files, the site updates filed under the stage
 * they belong to, and the certificates actually issued. The client had a flat list in
 * `DocumentVault`. The same project looked like two different projects depending on who
 * opened it, and a change to one never reached the other.
 *
 * Shared properly, not copied: ONE component renders both. These assertions exist so
 * the next change cannot quietly fork it again.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SHARED     = 'src/components/project/ProjectDocuments.tsx';
const CONTRACTOR = 'src/app/routes/work/projects.detail.tsx';
const CLIENT     = 'src/app/routes/projects/detail.tsx';
const WRAPPER    = 'src/components/project/ClientDocuments.tsx';

describe('one component, both roles', () => {
  it('the contractor renders the shared view', () => {
    const body = code(CONTRACTOR);
    expect(body).toMatch(/<ProjectDocuments/);
    // The inline copy is gone, not merely unused.
    expect(body).not.toMatch(/function DocumentsTab\(/);
  });

  it('the client renders the same shared view, through its upload wrapper', () => {
    expect(code(CLIENT)).toMatch(/<ClientDocuments/);
    expect(code(CLIENT), 'the old flat list').not.toMatch(/<DocumentVault/);
    expect(code(WRAPPER)).toMatch(/<ProjectDocuments/);
  });

  it('neither side reimplements the chips or the groups', () => {
    for (const f of [CONTRACTOR, CLIENT, WRAPPER]) {
      const body = code(f);
      expect(body, `${f} builds its own chips`).not.toMatch(/contractorDocs\.chipAll/);
      expect(body, `${f} builds its own groups`).not.toMatch(/contractorDocs\.siteUpdatesFiled/);
    }
  });
});

// Catalogue filtering, actual evidence, issuance and signed-URL races are exercised
// by documents/project-documents-screen.test.ts; these checks protect role wiring.

describe('what stays role-specific', () => {
  it('uploading is passed in, not built into the shared view', () => {
    // A button the contractor's side has to switch off is how a shared view starts
    // having two personalities again.
    const shared = code(SHARED);
    expect(shared).not.toMatch(/uploadDocument|FILE_ACCEPT_ATTR/);
    expect(shared).toMatch(/toolbar\?: ReactNode/);
  });

  it('the contractor passes no upload toolbar', () => {
    const call = code(CONTRACTOR).slice(code(CONTRACTOR).indexOf('<ProjectDocuments'));
    expect(call.slice(0, call.indexOf('/>'))).not.toMatch(/toolbar=/);
  });

  it('an invited client is offered no upload', () => {
    // 112 makes them a viewer. The server refuses the write; this does not offer it.
    expect(code(CLIENT)).toMatch(/canUpload=\{isOwner \|\| isContractor\}/);
    expect(code(WRAPPER)).toMatch(/toolbar=\{canUpload \?/);
  });

  it('an upload lands in the list without a reload', () => {
    expect(code(WRAPPER)).toMatch(/setDocs\(prev => \[newDoc, \.\.\.prev\]\)/);
  });

  it('the bucket\'s own rules are checked before the file is sent', () => {
    // A file that passes here and fails at Storage is an upload that vanishes silently.
    expect(code(WRAPPER)).toMatch(/const problem = fileProblem\(file\)/);
    expect(code(WRAPPER)).toMatch(/getProjectStorageUsed/);
  });
});
