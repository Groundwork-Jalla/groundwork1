import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILT_TABS, WORKSPACE_TABS, domainState, parseWorkspaceParams, selectedStage, workspaceHref,
} from './workspace-params';
import type { StageView } from './workspace';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step 4 — the workspace route, header and Overview tab.
 *
 * The runner has no DOM, so what is pinned here is (a) every decision the screen makes,
 * which lives in pure helpers, and (b) the shape of the components as source: that they
 * read the assembled model and never re-derive it, that the route renders the honest
 * not-found, that lists are previews, and that no id reaches the screen raw.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
/** Code only — the headers explain in comments what the files must not do. */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const ROUTE   = 'src/app/routes/admin/projects.detail.tsx';
const HEADER  = 'src/components/admin/workspace/WorkspaceHeader.tsx';
const TAB     = 'src/components/admin/workspace/OverviewTab.tsx';
const LADDER  = 'src/components/admin/workspace/StageLadder.tsx';
const PANEL   = 'src/components/admin/workspace/SelectedStagePanel.tsx';
const ALL     = [ROUTE, HEADER, TAB, LADDER, PANEL];

// ── URL ──────────────────────────────────────────────────────────────────────────────

describe('the URL is the state', () => {
  it('defaults to the overview tab, with nothing selected', () => {
    expect(parseWorkspaceParams(new URLSearchParams(''))).toEqual({ tab: 'overview', stageId: null, conversationId: null });
  });

  it('reads tab, stage and conversation', () => {
    expect(parseWorkspaceParams(new URLSearchParams('tab=stages&stage=s2&conversation=c9')))
      .toEqual({ tab: 'stages', stageId: 's2', conversationId: 'c9' });
  });

  it('treats an unknown tab as overview rather than a blank page', () => {
    expect(parseWorkspaceParams(new URLSearchParams('tab=wallet')).tab).toBe('overview');
  });

  it('builds links that omit the default tab and carry the selection', () => {
    expect(workspaceHref('p1')).toBe('/admin/projects/p1');
    expect(workspaceHref('p1', { tab: 'overview' })).toBe('/admin/projects/p1');
    expect(workspaceHref('p1', { tab: 'overview', stageId: 's3' })).toBe('/admin/projects/p1?stage=s3');
    expect(workspaceHref('p1', { tab: 'activity' })).toBe('/admin/projects/p1?tab=activity');
    expect(workspaceHref('p1', { tab: 'conversations', conversationId: 'c1' })).toBe('/admin/projects/p1?tab=conversations&conversation=c1');
  });

  it('is one route with search params, not nested routes', () => {
    const routes = src('src/app/routes.ts');
    expect(routes).toMatch(/route\("admin\/projects\/:id",\s*"routes\/admin\/projects\.detail\.tsx"\)/);
    expect(routes).not.toMatch(/admin\/projects\/:id\//);
    // /new is a literal segment and must stay declared; the router prefers it over :id.
    expect(routes).toMatch(/route\("admin\/projects\/new"/);
  });

  it('every tab has a label in both dictionaries, and the built list is exactly steps 4 + 5a + 5b', () => {
    for (const tab of WORKSPACE_TABS) {
      expect(lookup(en, `admin.workspace.tabs.${tab}`), tab).toBeTypeOf('string');
      expect(lookup(fr, `admin.workspace.tabs.${tab}`), tab).toBeTypeOf('string');
    }
    expect(BUILT_TABS).toEqual(['overview', 'activity', 'site-updates', 'documents', 'financials', 'stages', 'conversations']);
    expect(src(ROUTE)).toContain("t('admin.workspace.tabNotBuilt')");
  });
});

// ── Selection ────────────────────────────────────────────────────────────────────────

const view = (id: string, n: number): StageView => ({
  stage: { id, stage_number: n } as StageView['stage'],
  substages: [], lifecycle: { state: 'locked', blockers: [] }, latestVerification: null, verifications: [],
  siteUpdates: [], tranche: null, release: null, certificateId: null, nextStageStarted: false,
});

describe('selectedStage', () => {
  const stages = [view('a', 1), view('b', 2), view('c', 3)];
  const ws = { stages, currentStage: stages[1] };

  it('takes the stage named in the URL when it belongs to this project', () => {
    expect(selectedStage(ws, 'c')?.stage.id).toBe('c');
  });

  it('falls back to the current stage for a stale or foreign id, and for none', () => {
    expect(selectedStage(ws, 'zzz')?.stage.id).toBe('b');
    expect(selectedStage(ws, null)?.stage.id).toBe('b');
  });

  it('falls back to the first stage when the project has no current one, and to null with no stages', () => {
    expect(selectedStage({ stages, currentStage: null }, null)?.stage.id).toBe('a');
    expect(selectedStage({ stages: [], currentStage: null }, null)).toBeNull();
  });
});

// ── Empty vs not applied vs failed ───────────────────────────────────────────────────

describe('domainState tells the three apart', () => {
  it('error beats everything; unavailable beats empty; empty is only a real zero', () => {
    expect(domainState(true,  'boom',    0)).toBe('error');
    expect(domainState(false, 'boom',    0)).toBe('error');
    expect(domainState(false, undefined, 0)).toBe('unavailable');
    expect(domainState(true,  undefined, 0)).toBe('empty');
    expect(domainState(true,  undefined, 3)).toBe('ready');
  });

  it('the Overview renders a note, not zeros, for unavailable and error', () => {
    const tab = code(TAB);
    expect(tab).toContain("ledgerState === 'unavailable' || ledgerState === 'error'");
    expect(tab).toContain("activityState === 'unavailable' || activityState === 'error'");
    expect(lookup(en, 'admin.workspace.overview.domain.unavailable')).toBeTypeOf('string');
    expect(lookup(en, 'admin.workspace.overview.domain.error')).toContain('{reason}');
    expect(lookup(fr, 'admin.workspace.overview.domain.error')).toContain('{reason}');
  });
});

// ── The components read the model; they do not re-derive it ────────────────────────

describe('the loader is the only data boundary', () => {
  it('the route loads once through loadWorkspace and renders the honest not-found for null', () => {
    const route = code(ROUTE);
    expect(route).toContain('loadWorkspace(id)');
    expect(route).toContain('loaded === null');
    expect(route).toContain("t('admin.workspace.notFound')");
    expect(route).not.toMatch(/supabase\.from\(|\.rpc\(/);
  });

  it('no component queries a table or an RPC of its own', () => {
    for (const f of ALL) {
      const c = code(f);
      expect(c, f).not.toMatch(/supabase\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
    }
  });

  it('every lifecycle badge receives the assembled lifecycle, and nobody recomputes it', () => {
    for (const f of ALL) {
      const c = code(f);
      expect(c, f).not.toContain('stageLifecycle(');
      expect(c, f).not.toContain('availableFunds(');
      expect(c, f).not.toContain('payment_status');
    }
    expect(code(HEADER)).toContain('lifecycle={current.lifecycle}');
    expect(code(LADDER)).toContain('lifecycle={view.lifecycle}');
    expect(code(PANEL)).toContain('lifecycle={view.lifecycle}');
  });

  it('blockers come from workspace.openBlockers, with an honest empty state', () => {
    const tab = code(TAB);
    expect(tab).toContain('ws.openBlockers.map(');
    expect(tab).toContain('ws.openBlockers.length === 0');
    expect(tab).toContain('admin.workspace.overview.blockersEmpty');
    expect(tab).not.toMatch(/blockers\s*=\s*\[/);   // no list assembled in the UI
  });

  it('the financial summary shows only what the loader knows, with no custody language', () => {
    const tab = code(TAB);
    for (const f of ['fin.budgetUsd', 'fin.funded', 'fin.availableFunds', 'fin.authorised', 'fin.inFlight', 'fin.disbursed']) expect(tab).toContain(f);
    for (const f of [TAB, HEADER, PANEL]) {
      const text = src(f).toLowerCase();
      expect(text, f).not.toMatch(/\bescrow\b|\bwallet\b|balance held/);
    }
    expect(lookup(en, 'admin.workspace.overview.financialSub')).not.toMatch(/escrow|wallet/i);
    expect(lookup(fr, 'admin.workspace.overview.financialSub')).not.toMatch(/escrow|wallet|portefeuille/i);
  });
});

// ── Previews and names ───────────────────────────────────────────────────────────────

describe('the Overview is a preview', () => {
  it('shows at most five activity rows, and See all opens the activity tab', () => {
    const tab = code(TAB);
    expect(tab).toContain('const OVERVIEW_ROWS = 5;');
    expect(tab).toContain('ws.activity.slice(0, OVERVIEW_ROWS)');
    expect(tab).toContain("workspaceHref(p.id, { tab: 'activity' })");
    expect(tab).toContain('actionLabel(a.action, t)');   // the shared map, not a local one
  });

  it('the ladder lists every stage in order as links that select via ?stage=', () => {
    const ladder = code(LADDER);
    // Selection stays within the tab the ladder is shown on; the Overview passes nothing
    // and gets `overview`, the Stages tab passes itself (5b.2).
    expect(ladder).toContain("workspaceHref(projectId, { tab, stageId: view.stage.id })");
    expect(ladder).toContain("tab = 'overview'");
    expect(ladder).toContain('stages.map(');
    // Ordering is the loader's (assembleWorkspace sorts by stage_number) — the ladder must not re-sort.
    expect(ladder).not.toContain('.sort(');
  });

  it('never shows a raw id to the admin', () => {
    for (const f of ALL) {
      const c = code(f);
      expect(c, f).not.toMatch(/\.slice\(0,\s*8\)/);     // the "short uuid" habit
      expect(c, f).not.toMatch(/(?<![=$])\{(?:p|ws\.project)\.id\}/);   // an id rendered as text (a prop `={p.id}` or a URL `${p.id}` is fine)
      expect(c, f).not.toMatch(/(?<![=$])\{(?:owner|a|v|u)\.(?:actorId|personId|verifierId|submittedBy|id)\}/);   // `key={a.id}` is not shown
    }
    expect(code(HEADER)).toContain("t('admin.workspace.header.unknownAccount')");
    expect(code(PANEL)).toContain("t('admin.workspace.header.unknownAccount')");
  });
});

// ── Both themes, both languages ──────────────────────────────────────────────────────

describe('Phase 5 audit findings, pinned', () => {
  it('a header act re-reads the workspace like every other write', () => {
    expect(code(ROUTE)).toContain('onNotice={n => { setNotice(n); reload(); }}');
  });

  it('a project with no budget estimate reads "—", never "$0.00"', () => {
    expect(code(TAB)).toContain('value={p.budget_usd == null ? null : fin.budgetUsd}');
    expect(code('src/components/admin/workspace/FinancialsTab.tsx')).toContain('value={ws.project.budget_usd == null ? null : fin.budgetUsd}');
  });
});

describe('themes and languages', () => {
  it('every light surface in the workspace has a dark counterpart', () => {
    for (const f of ALL) {
      const c = src(f);
      const lightSurfaces = (c.match(/(?<!dark:)\bbg-white\b/g) ?? []).length;
      const darkSurfaces  = (c.match(/dark:bg-\[#1e1e1e\]/g) ?? []).length;
      expect(darkSurfaces, `${f}: bg-white without dark:bg-[#1e1e1e]`).toBeGreaterThanOrEqual(lightSurfaces);
      expect(c, f).not.toMatch(/bg-(green|amber|red|yellow|emerald|rose|blue)-\d/);   // accents only
    }
  });

  it('the workspace strings exist in both dictionaries and differ', () => {
    for (const key of [
      'admin.workspace.back', 'admin.workspace.notFound', 'admin.workspace.notFoundBody', 'admin.workspace.tabNotBuilt',
      'admin.workspace.header.stageOf', 'admin.workspace.header.trackingSince', 'admin.workspace.header.notTracking',
      'admin.workspace.header.unknownAccount', 'admin.workspace.overview.blockersEmpty', 'admin.workspace.overview.progress',
      'admin.workspace.stage.eyebrow', 'admin.workspace.stage.openInStages', 'admin.workspace.stage.milestoneNone',
    ]) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, `en ${key}`).toBeTypeOf('string');
      expect(f, `fr ${key}`).toBeTypeOf('string');
      expect(e, `${key} not translated`).not.toBe(f);
    }
  });
});
