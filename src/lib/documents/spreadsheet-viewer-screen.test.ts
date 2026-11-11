import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { MAX_FILE_BYTES } from './accepted-files';

const h = vi.hoisted(() => ({ hooks: [] as any[], index: 0, effects: [] as (() => void)[],
  workers: [] as any[], fetch: vi.fn(), needsPassword: false, mfa: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.index++; if (!(i in h.hooks)) h.hooks[i] = typeof initial === 'function' ? initial() : initial;
    return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === 'function' ? value(h.hooks[i]) : value; }]; },
  useEffect: (effect: () => any, deps: any[]) => { const i = h.index++, old = h.hooks[i];
    if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) h.effects.push(() => { old?.cleanup?.(); h.hooks[i] = { deps, cleanup: effect() }; }); },
  useId: () => 'sheet',
}));
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/auth/account-security', () => ({ googleWithoutPassword: () => h.needsPassword, secondFactorEnabled: h.mfa }));
import { SpreadsheetViewer } from '@/components/project/SpreadsheetViewer';
import { SecurityNudges } from '@/components/dashboard/SecurityNudges';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function render(component: () => ReactNode = () => SpreadsheetViewer({ url: 'https://files.test/bill.xlsx' })) {
  h.index = 0; h.effects = []; const tree = component();
  for (const effect of h.effects) effect();
  return { all: nodes(tree), html: renderToStaticMarkup(tree) };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const preview = { sheets: [
  { name: 'Summary', rows: [['Grand total', '141407337.524'], ['<script>alert(1)</script>', '']], columns: 2, truncated: false },
  { name: 'Detail', rows: [['Foundation', '80']], columns: 2, truncated: false },
], truncated: false };

beforeEach(() => {
  h.hooks = []; h.index = 0; h.effects = []; h.workers = []; vi.clearAllMocks();
  h.needsPassword = false; h.mfa.mockResolvedValue(false);
  h.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', h.fetch);
  vi.stubGlobal('Worker', class {
    onmessage: any; onerror: any; terminate = vi.fn(); postMessage = vi.fn();
    constructor() { h.workers.push(this); }
  });
});
afterEach(() => { for (const hook of h.hooks) hook?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('spreadsheet preview lifecycle', () => {
  it('parses off the main thread, escapes cell text and switches sheets', async () => {
    render(); await flush();
    const worker = h.workers[0]; expect(worker.postMessage).toHaveBeenCalledOnce();
    worker.onmessage({ data: { ok: true, preview } });
    let view = render();
    expect(worker.terminate).toHaveBeenCalled();
    expect(view.html).toContain('141407337.524');
    expect(view.html).toContain('&lt;script&gt;'); expect(view.html).not.toContain('<script>');
    view.all.filter(node => node.props.role === 'tab')[1].props.onClick();
    view = render(); expect(view.html).toContain('Foundation'); expect(view.html).not.toContain('Grand total');
  });

  it('aborts and terminates the old worker, ignoring its result after another file opens', async () => {
    let url = 'https://files.test/old.xlsx'; const component = () => SpreadsheetViewer({ url });
    render(component); await flush(); const old = h.workers[0];
    url = 'https://files.test/new.xlsx'; render(component); await flush();
    expect(old.terminate).toHaveBeenCalled();
    expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    old.onmessage({ data: { ok: true, preview } });
    expect(render(component).html).not.toContain('141407337.524');
  });

  it('refuses a large response before starting a parser', async () => {
    h.fetch.mockResolvedValue(new Response('oversized', { headers: { 'content-length': String(MAX_FILE_BYTES + 1) } }));
    render(); await flush();
    expect(h.workers).toHaveLength(0);
    expect(render().html).toContain('project.review.spreadsheetFailed');
  });

  it('ends an unresponsive parse and allows retry without accepting a late result', async () => {
    vi.useFakeTimers(); render(); await flush();
    const worker = h.workers[0];
    await vi.advanceTimersByTimeAsync(12_000);
    expect(worker.terminate).toHaveBeenCalled();
    worker.onmessage({ data: { ok: true, preview } });
    expect(render().html).toContain('project.review.spreadsheetFailed');
    h.fetch.mockResolvedValue(new Response(new Uint8Array([4, 5])));
    render().all.find(node => node.type === 'button')!.props.onClick();
    render(); await flush();
    expect(h.workers).toHaveLength(2);
    h.workers[1].onmessage({ data: { ok: true, preview } });
    expect(render().html).toContain('141407337.524');
  });
});

describe('dashboard security nudges', () => {
  const user = { id: 'user' } as User;
  it('retains password recovery while suppressing the dashboard 2FA action and read', () => {
    h.needsPassword = true;
    const view = render(() => SecurityNudges({ user, showTwoFactor: false }));
    expect(view.html).toContain('dashboard.security.passwordTitle');
    expect(view.html).not.toContain('dashboard.security.twoFactorTitle');
    expect(h.mfa).not.toHaveBeenCalled();
  });
  it('has no nudge for a user who already has a password', () => {
    expect(render(() => SecurityNudges({ user, showTwoFactor: false })).html).toBe('');
  });
});
