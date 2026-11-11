import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentRow } from '@/types/project';

const h = vi.hoisted(() => ({ hooks: [] as any[], index: 0, effects: [] as (() => void)[],
  certificates: vi.fn(), updates: vi.fn(), substages: vi.fn(), documentUrl: vi.fn(), evidenceUrl: vi.fn(),
  projects: vi.fn(), vault: {} as Record<string, any>, filters: [] as any[],
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.index++; if (!(i in h.hooks)) h.hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === 'function' ? value(h.hooks[i]) : value; }]; },
  useRef: (initial: any) => { const i = h.index++; return h.hooks[i] ?? (h.hooks[i] = { current: initial }); },
  useCallback: (callback: any) => callback,
  useEffect: (effect: () => any, deps: any[]) => { const i = h.index++, old = h.hooks[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) h.effects.push(() => { old?.cleanup?.(); h.hooks[i] = { deps, cleanup: effect() }; }); },
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ docCategory: (value: string) => value }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (stage: any) => stage.name }) }));
vi.mock('@/lib/supabase/certificates', () => ({ fetchProjectCertificates: h.certificates }));
vi.mock('@/lib/supabase/site-updates', () => ({ listSiteUpdates: h.updates }));
vi.mock('@/lib/supabase/contractor-work', () => ({ fetchSubstages: h.substages }));
vi.mock('@/lib/supabase/documents', () => ({ getSignedDocumentUrl: h.documentUrl, signedUrlIn: h.evidenceUrl }));
vi.mock('@/lib/supabase/projects', () => ({ fetchClientProjects: h.projects }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  from: (table: string) => ({
    select() { return this; }, in() { return this; },
    is(...values: any[]) { h.filters.push([table, 'is', ...values]); return this; },
    not(...values: any[]) { h.filters.push([table, 'not', ...values]); return this; },
    order: () => Promise.resolve(h.vault[table]),
  }),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn(),
} }));
vi.mock('@/components/project/DocumentViewer', () => ({ DocumentViewer: 'viewer' }));
import DocumentsPage from '@/app/routes/documents';
import { ProjectDocuments } from '@/components/project/ProjectDocuments';
import { FileRow, Group } from '@/components/project/DocumentList';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
let projectId = 'project';
let documents: ProjectDocumentRow[];
const stages = [{ id: 's1', name: 'Foundation', stage_number: 1, stage_key: 'foundation', status: 'complete' },
  { id: 'historical', name: 'Walls', stage_number: 2, stage_key: 'superstructure', status: 'complete' }];
function render() { h.index = 0; h.effects = []; const tree = ProjectDocuments({ projectId, documents, stages });
  for (const effect of h.effects) effect(); return { all: nodes(tree), text: text(tree) }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const rows = () => render().all.filter(node => node.type === FileRow);
const viewer = () => render().all.find(node => node.type === 'viewer');

beforeEach(() => {
  for (const hook of h.hooks) hook?.cleanup?.();
  h.hooks = []; h.index = 0; h.effects = []; vi.clearAllMocks();
  projectId = 'project'; documents = []; h.filters = [];
  h.projects.mockResolvedValue({ all: [{ id: 'project', name: 'Home', tier: 'self_verify' }] });
  h.vault = { project_documents: { data: [], error: null }, certificates: { data: [], error: null } };
  h.certificates.mockResolvedValue(new Map()); h.updates.mockResolvedValue({ rows: [], available: true }); h.substages.mockResolvedValue([]);
  h.documentUrl.mockResolvedValue('https://files.test/bill'); h.evidenceUrl.mockResolvedValue('https://files.test/photo');
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('one actual-file view for every project participant', () => {
  it('complete stages alone produce no media, groups or certificates', async () => {
    render(); await flush();
    expect(rows()).toHaveLength(0);
    expect(render().all.filter(node => node.type === Group)).toHaveLength(0);
    expect(render().text).toContain('contractorProject.noDocuments');
    expect(h.certificates).toHaveBeenCalledWith('project', { strict: true });
  });

  it('shows actual files, distinct site evidence and only an issued PDF', async () => {
    documents = [{ id: 'bill', file_name: 'Bill.xlsx', file_path: 'project/bill.xlsx', category: 'boq', created_at: '2026-11-12' }] as ProjectDocumentRow[];
    h.updates.mockResolvedValue({ available: true, rows: [{ id: 'u1', stageId: 's1', evidencePaths: ['project/photo.jpg'], description: 'Pour', submittedAt: '2026-11-12' }] });
    h.substages.mockResolvedValue([{ id: 'sub', stage_id: 's1', evidence_urls: ['project/photo.jpg'] }]);
    h.certificates.mockResolvedValue(new Map([
      ['historical', { id: 'cert', stageId: 'historical', pdfUrl: 'https://files.test/issued.pdf' }],
      ['s1', { id: 'no-pdf', stageId: 's1', pdfUrl: null }],
    ]));
    render(); await flush();
    expect(rows().map(node => node.props.name)).toEqual(['Bill.xlsx', 'photo.jpg', 'Walls']);
    rows().find(node => node.props.name === 'photo.jpg')!.props.onOpen(); await flush();
    expect(h.evidenceUrl).toHaveBeenCalledWith('evidence', 'project/photo.jpg');
    expect(viewer()?.props.url).toBe('https://files.test/photo');
    rows().find(node => node.props.name === 'Walls')!.props.onOpen();
    expect(viewer()?.props.url).toBe('https://files.test/issued.pdf');
  });

  it('search counts and file actions follow actual matches', async () => {
    documents = [{ id: 'bill', file_name: 'Bill.xlsx', file_path: 'project/bill.xlsx', category: 'boq', created_at: '2026-11-12' },
      { id: 'plan', file_name: 'Plan.pdf', file_path: 'project/plan.pdf', category: 'plan', created_at: '2026-11-11' }] as ProjectDocumentRow[];
    render(); await flush();
    render().all.find(node => node.type === 'input')!.props.onChange({ target: { value: 'bill' } });
    expect(rows()).toHaveLength(1);
    const allChip = render().all.find(node => node.type === 'button' && text(node).includes('contractorDocs.chipAll'))!;
    expect(text(allChip)).toContain('1');
    rows()[0].props.onOpen(); await flush();
    expect(h.documentUrl).toHaveBeenCalledWith('project/bill.xlsx');
    expect(viewer()?.props.name).toBe('Bill.xlsx');
  });

  it('a read failure is retryable, not a claim that no certificates exist', async () => {
    h.certificates.mockRejectedValue(new Error('offline'));
    render(); await flush();
    expect(render().text).toContain('project.review.documentsLoadFailed');
    expect(render().text).not.toContain('contractorProject.noDocuments');
    h.certificates.mockResolvedValue(new Map());
    render().all.find(node => node.type === 'button' && text(node) === 'common.retry')!.props.onClick();
    render(); await flush();
    expect(render().text).toContain('contractorProject.noDocuments');
  });

  it.each(['close', 'project-change'])('ignores a pending signed URL after %s', async action => {
    let finish!: (url: string) => void;
    h.documentUrl.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    documents = [{ id: 'bill', file_name: 'Bill.xlsx', file_path: 'project/bill.xlsx', category: 'boq' }] as ProjectDocumentRow[];
    render(); await flush(); rows()[0].props.onOpen();
    if (action === 'close') viewer()!.props.onClose();
    else { projectId = 'other'; documents = []; render(); }
    finish('https://files.test/old-bill'); await flush();
    expect(viewer()).toBeUndefined();
  });
});


function renderVault() {
  h.index = 0; h.effects = []; const tree = DocumentsPage();
  for (const effect of h.effects) effect();
  return { all: nodes(tree), text: text(tree) };
}
describe('the dashboard document vault uses the same issued-file rules', () => {
  it('requests only unrevoked issued PDFs and does not promise certificates by plan', async () => {
    renderVault(); await flush();
    expect(h.filters).toContainEqual(['certificates', 'is', 'revoked_at', null]);
    expect(h.filters).toContainEqual(['certificates', 'not', 'pdf_url', 'is', null]);
    const chip = renderVault().all.find(node => node.type === 'button' && text(node).startsWith('contractorDocs.chipCerts'))!;
    chip.props.onClick();
    expect(renderVault().text).toContain('project.review.certificatesEmpty');
    expect(renderVault().text).not.toContain('documents.certsSelfVerify');
  });
  it('keeps real documents openable when a certificate read fails, with retry and no fake empty claim', async () => {
    h.vault = { certificates: { data: null, error: new Error('offline') }, project_documents: { error: null,
      data: [{ id: 'bill', project_id: 'project', file_name: 'Bill.xlsx', file_path: 'project/bill.xlsx', category: 'boq', created_at: '2026-11-12' }] } };
    renderVault(); await flush();
    let view = renderVault();
    expect(view.text).toContain('project.review.documentsLoadFailed');
    expect(view.text).not.toContain('documents.noDocuments');
    view.all.find(node => node.type === FileRow)!.props.onOpen(); await flush();
    view = renderVault();
    expect(view.all.find(node => node.type === 'viewer')?.props.url).toBe('https://files.test/bill');
    expect(h.documentUrl).toHaveBeenCalledWith('project/bill.xlsx');
  });
});
