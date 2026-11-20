import { describe, expect, it, vi } from 'vitest';
import { handleCors, isAllowedCorsOrigin } from '../../../api/_lib/cors';

function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let ended = false;
  return {
    headers,
    get statusCode() { return statusCode; },
    get ended() { return ended; },
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return { end: vi.fn(() => { ended = true; }) };
    }),
  };
}

describe('Capacitor native CORS policy', () => {
  it('allows explicit Capacitor native origins and rejects arbitrary origins', () => {
    expect(isAllowedCorsOrigin('capacitor://localhost')).toBe(true);
    expect(isAllowedCorsOrigin('https://localhost')).toBe(true);
    expect(isAllowedCorsOrigin('http://localhost')).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example')).toBe(false);
    expect(isAllowedCorsOrigin(undefined)).toBe(false);
  });

  it('handles OPTIONS preflight with 204 and echoes allowed Capacitor origin', () => {
    const res = mockRes();
    const handled = handleCors({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('does not attach permissive CORS headers for untrusted cross-origin requests', () => {
    const res = mockRes();
    const handled = handleCors({ method: 'POST', headers: { origin: 'https://untrusted.example' } }, res);
    expect(handled).toBe(false);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
