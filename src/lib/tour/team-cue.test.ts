import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], si: 0, ri: 0, effects: [] as (() => any)[],
  inviteAvailable: false, callback: null as (() => void) | null, options: null as MutationObserverInit | null,
  frames: [] as FrameRequestCallback[], query: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useEffect: (effect: () => any) => { h.effects.push(effect); },
  useLayoutEffect: (effect: () => any) => { h.effects.push(effect); },
  useCallback: (callback: any) => callback,
}));
vi.mock('react-router', () => ({ useLocation: () => ({ pathname: '/projects/project' }) }));
vi.mock('react-dom', () => ({ createPortal: (children: any) => children }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'client' } }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/tour/completion',()=>({readTourCompletion:vi.fn().mockResolvedValue([]),completedTourSteps:(seen:string[],completed:string[])=>[...seen,...completed]}));
vi.mock('@/lib/tour/seen', () => ({ readSeen: () => [], markSeen: vi.fn(), dismissTour: vi.fn() }));
import { TourGuide } from '@/components/tour/TourGuide';
import { readTourCompletion } from '@/lib/tour/completion';

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children)] : [];
}
function render() {
  h.si = h.ri = 0; h.effects = [];
  return nodes(TourGuide({ tour: 'client-setup' }));
}
function frames() { for (const callback of h.frames.splice(0)) callback(0); }
function attributeChanged(attribute: string) {
  if (h.options?.attributes && h.options.attributeFilter?.includes(attribute)) h.callback?.();
  frames();
}
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks(); h.state = []; h.refs = []; h.effects = []; h.frames = []; h.inviteAvailable = false; h.callback = null; h.options = null;
  h.query.mockImplementation((selector: string) => selector === '[data-tour="invite-contractor"]' && h.inviteAvailable
    ? { getBoundingClientRect: () => ({ top: 80, left: 200, width: 90, height: 42 }) } : null);
  vi.stubGlobal('document', { body: {}, querySelector: h.query, elementFromPoint: () => null });
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { h.frames.push(callback); return h.frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { h.callback = callback; }
    observe(_element: any, options: MutationObserverInit) { h.options = options; }
    disconnect() {}
  });
  render(); for (const effect of h.effects.splice(0)) effect(); frames();
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals(); });

describe('Team invitation guidance follows project permissions', () => {
  it('appears when the permission response adds a cue to an existing Team tab', () => {
    expect(render()).toEqual([]);
    h.inviteAvailable = true; attributeChanged('data-tour');
    expect(render().find(node => node.props.role === 'dialog')?.props['aria-label']).toBe('tour.client.invite.title');
  });
  it('disappears when a pending or accepted contractor removes the invitation cue', () => {
    h.inviteAvailable = true; attributeChanged('data-tour'); render();
    h.inviteAvailable = false; attributeChanged('data-tour');
    expect(render()).toEqual([]);
  });
  it('does not remeasure for animated classes and styles', () => {
    const reads = h.query.mock.calls.length;
    attributeChanged('class'); attributeChanged('style');
    expect(h.query).toHaveBeenCalledTimes(reads);
  });
  it('suppresses a completed invitation using server facts even when this browser has never seen the tour', async () => {
    h.inviteAvailable = true; attributeChanged('data-tour');
    expect(render().some(node => node.props.role === 'dialog')).toBe(true);
    vi.mocked(readTourCompletion).mockResolvedValueOnce(['invite-contractor']);
    render(); h.effects[0](); await Promise.resolve(); await Promise.resolve();
    render(); for (const effect of h.effects.splice(0)) effect(); frames();
    expect(render()).toEqual([]);
  });
});
