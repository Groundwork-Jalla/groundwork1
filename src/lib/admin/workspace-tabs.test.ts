import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionCenterItems, stageLink } from './action-center';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step 5a — deep links, and the three read-only tabs (Activity, Site Updates, Documents).
 *
 * Same discipline as Step 4: every tab reads `ws.*`, opens files only through the two
 * existing signed-URL readers, writes nothing, and says "not applied" / "failed" /
 * "empty" as three different things. Deep links use the one href builder so a queue
 * row, the dashboard and the Action Center cannot disagree about where a project lives.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const ACTIVITY = 'src/components/admin/workspace/ActivityTab.tsx';
const UPDATES  = 'src/components/admin/workspace/SiteUpdatesTab.tsx';
const DOCS     = 'src/components/admin/workspace/DocumentsTab.tsx';
const EVIDENCE = 'src/components/admin/workspace/EvidenceList.tsx';
const TABS = [ACTIVITY, UPDATES, DOCS];

describe('5a.1 — every road leads to the workspace', () => {
  it('the dashboard flag is on and its project links use the href builder', () => {
    const overview = code('src/app/routes/admin/index.tsx');
    expect(overview).toContain('const WORKSPACE_READY = true;');
    expect(overview).toContain('const projectLink = (id: string) => workspaceHref(id);');
  });

  it('the projects row opens the workspace; the client view keeps its own icon', () => {
    const list = code('src/app/routes/admin/projects.tsx');
    expect(list).toContain('<Link to={workspaceHref(p.id)}');
    expect(list).toContain('to={`/projects/${p.id}`}');   // still there, still new-tab
  });

  it('a review card opens the workspace on its stage', () => {
    const reviews = code('src/app/routes/admin/reviews.tsx');
    expect(reviews).toContain("workspaceHref(item.projectId, { tab: 'stages', stageId: item.stageId })");
    expect(lookup(en, 'admin.workspace.openWorkspace')).toBeTypeOf('string');
    expect(lookup(fr, 'admin.workspace.openWorkspace')).toBeTypeOf('string');
  });

  it('the Action Center defaults to workspace links, on the right stage', () => {
    expect(stageLink('p1', 's9', true)).toBe('/admin/projects/p1?tab=stages&stage=s9');
    expect(code('src/lib/supabase/action-center.ts')).toContain('workspaceReady = true');
    // The pure rule set, called the way the /admin/action-center page calls it (no flag):
    const items = actionCenterItems({
      projects: [{ id: 'p1', name: 'X', ownerName: 'O', status: 'active', tier: 'jalla_management', tracking_started_at: null, created_at: '2026-09-01T00:00:00Z' }],
      stages: [], verifications: [], verifiers: [], siteUpdates: [], payments: [], unmatchedEvents: [],
      waiting: [], applications: [], inquiries: [], tickets: [],
      verificationsAvailable: true, siteUpdatesAvailable: true, ledgerAvailable: true, conversationsAvailable: true,
    } as never, new Date('2026-09-17T00:00:00Z'));
    const budget = items.find(i => i.kind === 'budget_unconfirmed');
    expect(budget?.to.startsWith('/admin/')).toBe(true);
    expect(items.every(i => !i.to.startsWith('/projects/'))).toBe(true);   // never the client page
  });
});

describe('5a.2–4 — the tabs read the model and write nothing', () => {
  it('no tab queries a table, calls an RPC, or submits anything', () => {
    for (const f of [...TABS, EVIDENCE]) {
      const c = code(f);
      expect(c, f).not.toMatch(/supabase\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upload\(|\.remove\(/);
      expect(c, f).not.toMatch(/submitSiteUpdate|uploadDocument|deleteDocument/);
    }
  });

  it('Activity is ws.activity through the shared label map, newest first as assembled', () => {
    const c = code(ACTIVITY);
    expect(c).toContain('ws.activity.map(');
    expect(c).toContain('actionLabel(a.action, t)');
    expect(c).not.toContain('.sort(');                 // order is the loader's
    expect(c).not.toContain('listAuditLog');           // no second source
    expect(c).not.toContain('listProjectActivity');
  });

  it('Site Updates is ws.siteUpdates, files through the evidence reader, no submit path', () => {
    const c = code(UPDATES);
    expect(c).toContain('ws.siteUpdates.map(');
    expect(c).toContain('<EvidenceList paths={u.evidencePaths} />');
    expect(code(EVIDENCE)).toContain('getSignedEvidenceUrl(p)');
    expect(c).not.toMatch(/<form|<textarea|<input/);
  });

  it('Documents is ws.documents, grouped, opened through the documents reader, read-only', () => {
    const c = code(DOCS);
    expect(c).toContain('ws.documents.filter(d => d.category === cat)');
    expect(c).toContain('getSignedDocumentUrl(path)');
    expect(c).not.toMatch(/<form|<input type="file"/);
    expect(lookup(en, 'admin.workspace.documents.readOnly')).toMatch(/read-only/i);
  });

  it('each tab distinguishes unavailable, error and empty', () => {
    for (const f of TABS) {
      const c = code(f);
      expect(c, f).toContain("state === 'unavailable' || state === 'error'");
      expect(c, f).toContain("state === 'empty'");
      expect(c, f).toContain('<DomainNote');
    }
  });

  it('a file that cannot be signed is marked, never dropped', () => {
    expect(code(EVIDENCE)).toContain("'opacity-50'");
    expect(code(DOCS)).toContain('admin.workspace.documents.unsigned');
  });

  it('never shows a raw id', () => {
    for (const f of TABS) {
      const c = code(f);
      expect(c, f).not.toMatch(/\.slice\(0,\s*8\)/);
      expect(c, f).not.toMatch(/(?<![=$])\{(?:a|u|d)\.(?:actorId|personId|submittedBy|uploaded_by|id)\}/);
    }
  });

  it('light surfaces are paired with dark ones; accents only', () => {
    for (const f of TABS) {
      const c = src(f);
      const light = (c.match(/(?<!dark:)\bbg-white\b/g) ?? []).length;
      const dark  = (c.match(/dark:bg-\[#1e1e1e\]/g) ?? []).length;
      expect(dark, f).toBeGreaterThanOrEqual(light);
      expect(c, f).not.toMatch(/bg-(green|amber|red|yellow|emerald|rose|blue)-\d/);
    }
  });

  it('every new string exists in both dictionaries and is translated', () => {
    for (const key of [
      'admin.workspace.activity.emptyBody', 'admin.workspace.activity.entity.payment',
      'admin.workspace.siteUpdates.empty', 'admin.workspace.siteUpdates.emptyBody', 'admin.workspace.siteUpdates.noDescription',
      'admin.workspace.documents.empty', 'admin.workspace.documents.readOnly', 'admin.workspace.documents.unsigned',
    ]) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} not translated`).not.toBe(f);
    }
  });
});
