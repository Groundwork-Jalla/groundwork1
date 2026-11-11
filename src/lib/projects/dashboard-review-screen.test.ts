import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '@/types/project';

const h = vi.hoisted(() => ({ hooks: [] as any[], index: 0, effects: [] as (() => void)[],
  projects: vi.fn(), stages: vi.fn(), user: { id: 'client', user_metadata: { full_name: 'Client' } },
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.index++; if (!(i in h.hooks)) h.hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === 'function' ? value(h.hooks[i]) : value; }]; },
  useEffect: (effect: () => any, deps: any[]) => { const i = h.index++, old = h.hooks[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) h.effects.push(() => { old?.cleanup?.(); h.hooks[i] = { deps, cleanup: effect() }; }); },
}));
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, AnimatePresence: 'presence' }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en', t: (key: string) => key, tPlural: (key: string) => key }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, isContractor: false }) }));
vi.mock('@/lib/supabase/participant-projects', () => ({ fetchParticipantProjects: h.projects }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (table: string) => ({
  select() { return this; }, eq() { return this; }, is() { return this; }, in() { return this; },
  order: () => h.stages(), then: (resolve: any) => Promise.resolve({ count: 0 }).then(resolve),
}) } }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ buildingType: (value: string) => value, country: (value: string) => value }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (row: any) => row.name }) }));
vi.mock('@/lib/budget/use-project-money', () => ({ useProjectMoney: () => ({ local: () => '100 XAF', pair: () => ({ local: '100 XAF', usd: '$1' }) }) }));
vi.mock('@/components/dashboard/SecurityNudges', () => ({ SecurityNudges: 'security-nudges' }));
vi.mock('@/components/project/ProjectPayoutSummary', () => ({ ProjectPayoutSummary: 'payout-summary' }));
import Dashboard from '@/app/routes/dashboard';
import ProjectsIndex from '@/app/routes/projects/index';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''; }
function render(component: () => any = Dashboard) { h.index = 0; h.effects = []; const tree = component();
  for (const effect of h.effects) effect(); return { all: nodes(tree), text: text(tree) }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const project = (id: string, status = 'active') => ({ id, name: id, status, current_stage: 1, country: 'CM', budget_source: 'boq', budget_amount: 100, budget_usd: 1 } as ProjectRow);
const result = (projects: ProjectRow[]) => ({ all: projects, owned: projects, shared: [], assigned: [], loadFailed: false });
function hero() { const row = render().all.find(node => node.type?.name === 'ActiveProjectHero')!; return row; }
function contents(node: Node) { return nodes(node.type(node.props)); }

beforeEach(() => {
  for (const hook of h.hooks) hook?.cleanup?.();
  h.hooks = []; h.index = 0; h.effects = []; vi.clearAllMocks();
  h.projects.mockResolvedValue(result([project('Home'), project('Other', 'on_hold')]));
  h.stages.mockResolvedValue({ data: [{ id: 'stage', name: 'Foundation', stage_number: 1, status: 'active', milestone_amount: 100, payment_milestone_usd: 1 }], error: null });
});

describe('client dashboard review changes', () => {
  it('keeps other projects, exactly two quick destinations and the actual payout component', async () => {
    render(); await flush(); render(); await flush();
    const view = render(), card = hero();
    expect(view.text).toContain('dashboard.otherProjects');
    const actions = view.all.find(node => node.type?.name === 'QuickActions')!;
    const links = contents(actions).filter(node => node.type === 'a');
    expect(links.map(node => node.props.to)).toEqual(['/projects/Home?tab=messages', '/documents']);
    expect(contents(card).some(node => node.type === 'payout-summary')).toBe(true);
    expect(view.all.some(node => node.type?.name === 'CostingDonut')).toBe(false);
    expect(view.all.find(node => node.type === 'security-nudges')?.props.showTwoFactor).toBe(false);
  });

  it('offers retry instead of a financial summary when the stage query fails', async () => {
    h.stages.mockResolvedValue({ data: null, error: new Error('offline') });
    render(); await flush(); render(); await flush();
    expect(hero().props.stagesError).toBe(true);
    expect(contents(hero()).some(node => node.type === 'payout-summary')).toBe(false);
    h.stages.mockResolvedValue({ data: [], error: null });
    hero().props.onRetryStages(); render(); await flush();
    expect(hero().props.stagesError).toBe(false);
  });

  it('ignores an earlier query after the active project changes', async () => {
    let finish!: (reply: any) => void;
    h.stages.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(); await flush(); render();
    h.projects.mockResolvedValue(result([project('New home')]));
    // A project-list retry replaces the active project while its first stage read is pending.
    const projectEffect = h.hooks.find(row => row?.deps?.[0] === h.user);
    projectEffect.cleanup();
    projectEffect.deps = []; render(); await flush(); render(); await flush();
    expect(hero().props.project.id).toBe('New home');
    finish({ data: [{ id: 'old-stage', status: 'complete' }], error: null }); await flush();
    expect(hero().props.stages.some((row: any) => row.id === 'old-stage')).toBe(false);
  });
});

describe('filtered projects are not a first-project state', () => {
  it('an empty On hold filter explains the filter and lets the client return to all projects', async () => {
    h.projects.mockResolvedValue(result([project('Home')]));
    render(ProjectsIndex); await flush();
    const button = render(ProjectsIndex).all.find(node => node.type === 'button' && text(node).includes('projects.filters.onHold'))!;
    expect(button).toBeDefined(); button.props.onClick();
    const view = render(ProjectsIndex);
    expect(view.text).toContain('project.review.noOnHold');
    expect(view.text).not.toContain('projects.empty.title');
    view.all.find(node => node.type === 'button' && text(node) === 'common.viewAll')!.props.onClick();
    expect(render(ProjectsIndex).all.some(node => node.type?.name === 'ProjectCard')).toBe(true);
  });
});
