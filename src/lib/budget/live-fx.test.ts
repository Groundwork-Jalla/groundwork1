import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUsdRates, USD_RATES_CACHE_MS } from './usd-rates';

const h = vi.hoisted(() => ({ states: [] as any[], deps: [] as any[], cleanups: [] as any[], effects: [] as any[], i: 0, e: 0 }));
vi.mock('react', () => ({
  useState: (value: any) => { const i = h.i++; if (!(i in h.states)) h.states[i] = value;
    return [h.states[i], (next: any) => { h.states[i] = next; }]; },
  useEffect: (effect: any, deps: any[]) => { const i = h.e++; if (!h.deps[i] || deps.some((value, j) => value !== h.deps[i][j])) {
    h.deps[i] = deps; h.effects.push({ i, effect });
  } },
}));
const now = Date.parse('2026-11-14T06:00:00Z');
const asOf = '2026-11-14T00:00:00.000Z';
const feed = (rate = 593.594, patch = {}) => ({ result: 'success', base_code: 'USD',
  time_last_update_unix: Date.parse(asOf) / 1000, rates: { USD: 1, XAF: rate, EUR: 0.8 }, ...patch });
let storage: Map<string, string>;
let useQuote: typeof import('./live-fx').useUsdQuote;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function render(code: string | null = 'XAF', fallback: number | null = 600) {
  h.i = h.e = 0;
  const value = useQuote(code, fallback);
  for (const { i, effect } of h.effects.splice(0)) { h.cleanups[i]?.(); h.cleanups[i] = effect(); }
  return value;
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); storage = new Map();
  h.states = []; h.deps = []; h.cleanups = []; h.effects = [];
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { setInterval, clearInterval, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => feed() }));
  useQuote = (await import('./live-fx')).useUsdQuote;
});
afterEach(() => { h.cleanups.forEach(cleanup => cleanup?.()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('dated browser exchange-rate quotes', () => {
  it('uses the same provider date and direction as the receipt reader', async () => {
    expect(render()).toMatchObject({ rate: 600, source: 'configured', asOf: null }); await flush();
    expect(render()).toEqual({ code: 'XAF', rate: 593.594, source: 'ExchangeRate-API', asOf });
    expect(parseUsdRates(feed(), now).asOf).toBe(asOf);
  });
  it('refreshes a long-lived tab after the cache expires', async () => {
    const { loadUsdRates } = await import('./live-fx');
    expect((await loadUsdRates())?.rates.XAF).toBe(593.594);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => feed(594) } as Response);
    vi.setSystemTime(now + USD_RATES_CACHE_MS + 1);
    expect((await loadUsdRates())?.rates.XAF).toBe(594);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('refreshes while a quote screen stays visible', async () => {
    render(); await flush(); render();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => feed(594) } as Response);
    await vi.advanceTimersByTimeAsync(USD_RATES_CACHE_MS + 1); await flush();
    expect(render().rate).toBe(594);
  });
  it('deduplicates simultaneous requests and retains the original quote date in storage', async () => {
    const { loadUsdRates } = await import('./live-fx');
    const [first, second] = await Promise.all([loadUsdRates(), loadUsdRates()]);
    expect(first).toEqual(second); expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.get('gw:fx:usd')!)).toMatchObject({ asOf, at: now });
  });
  it.each([
    { at: now, rates: { USD: 1, XAF: 586 } },
    { at: now + 1000, asOf, rates: { USD: 1, XAF: 586 } },
    { at: now - USD_RATES_CACHE_MS - 1, asOf, rates: { USD: 1, XAF: 586 } },
    { at: now, asOf: '2026-11-10T00:00:00Z', rates: { USD: 1, XAF: 586 } },
    { at: now, asOf, rates: { USD: 0.8, XAF: 586 } },
  ])('replaces legacy, expired or malformed stored rates: %j', async saved => {
    storage.set('gw:fx:usd', JSON.stringify(saved));
    const { loadUsdRates } = await import('./live-fx');
    expect((await loadUsdRates())?.rates.XAF).toBe(593.594); expect(fetch).toHaveBeenCalledOnce();
  });
  it('reuses a recent validated stored snapshot without a network request', async () => {
    storage.set('gw:fx:usd', JSON.stringify({ at: now - 1000, asOf, rates: { USD: 1, XAF: 590 } }));
    const { loadUsdRates } = await import('./live-fx');
    expect((await loadUsdRates())?.rates.XAF).toBe(590); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ base_code: 'EUR' }, { result: 'error' }, { time_last_update_unix: (now + 360_000) / 1000 },
    { time_last_update_unix: (now - 49 * 60 * 60_000) / 1000 }, { rates: { USD: 1, XAF: Infinity } }])(
    'identifies the fallback rather than labeling invalid data as live: %j', async patch => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => feed(590, patch) } as Response);
      render(); await flush(); expect(render()).toMatchObject({ rate: 600, source: 'configured', asOf: null });
    });
  it('retries after a network failure and never returns an old currency’s quote', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const { loadUsdRates } = await import('./live-fx');
    expect(await loadUsdRates()).toBeNull(); expect((await loadUsdRates())?.rates.XAF).toBe(593.594);
    render(); await flush(); expect(render('EUR', null)).toMatchObject({ code: 'EUR', rate: null, asOf: null });
    await flush(); expect(render('EUR', null)).toMatchObject({ rate: 0.8, source: 'ExchangeRate-API' });
  });
  it('uses parity for USD without a provider request', async () => {
    expect(render('USD', 600)).toMatchObject({ rate: 1, source: 'USD', asOf: null });
    await flush(); expect(fetch).not.toHaveBeenCalled();
  });
});
