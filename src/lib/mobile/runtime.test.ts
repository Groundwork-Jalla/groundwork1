import { describe, expect, it, vi } from 'vitest';
import {
  apiOrigin,
  apiUrl,
  authCallbackOrigin,
  installNativeApiBridge,
  isNativeApp,
  nativePlatform,
  parseNativeDeepLink,
} from '@/lib/mobile/runtime';
import { compressImageForUpload } from '@/lib/mobile/compress-image';

describe('Capacitor mobile runtime helpers', () => {
  it('stays a zero-overhead pass-through on standard web browsers', () => {
    const fakeWeb = { location: { protocol: 'https:', origin: 'https://tryjalla.com' } } as unknown as Window;
    expect(isNativeApp(fakeWeb)).toBe(false);
    expect(nativePlatform(fakeWeb)).toBe('web');
    expect(apiOrigin(false, 'https://tryjalla.com')).toBe('');
    expect(apiUrl('/api/events?action=live-chat', false, 'https://tryjalla.com')).toBe('/api/events?action=live-chat');
    expect(authCallbackOrigin('https://tryjalla.com', false)).toBe('https://tryjalla.com');
  });

  it('detects Capacitor iOS & Android shells and rewrites /api/* URLs cleanly', () => {
    const fakeIos = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
      location: { protocol: 'capacitor:', origin: 'capacitor://localhost' },
    } as unknown as Window;
    expect(isNativeApp(fakeIos)).toBe(true);
    expect(nativePlatform(fakeIos)).toBe('ios');
    expect(apiOrigin(true, '')).toBe('https://www.tryjalla.com');
    expect(apiUrl('/api/events?action=live-chat', true, 'https://tryjalla.com')).toBe(
      'https://tryjalla.com/api/events?action=live-chat',
    );
    expect(apiUrl('https://other.example/x', true, 'https://tryjalla.com')).toBe('https://other.example/x');
  });

  it('never leaks capacitor:// or ionic:// origins into auth callback URLs', () => {
    expect(authCallbackOrigin('capacitor://localhost', true, '')).toBe('https://www.tryjalla.com');
    expect(authCallbackOrigin('ionic://localhost', false, 'https://staging.tryjalla.com')).toBe(
      'https://staging.tryjalla.com',
    );
  });

  it('parses Universal Links and custom-scheme deep links while rejecting untrusted hosts', () => {
    expect(parseNativeDeepLink('https://tryjalla.com/invite/tok123?role=client')).toBe('/invite/tok123?role=client');
    expect(parseNativeDeepLink('https://www.tryjalla.com/auth/callback?code=abc')).toBe('/auth/callback?code=abc');
    expect(parseNativeDeepLink('com.tryjalla.groundwork://projects/p1?tab=stages')).toBe('/projects/p1?tab=stages');
    expect(parseNativeDeepLink('https://evil.example/invite/tok123')).toBeNull();
    expect(parseNativeDeepLink('javascript:alert(1)')).toBeNull();
  });

  it('rewrites relative /api/* fetches only when native bridge is active', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const fakeAndroid = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
      location: { protocol: 'https:', origin: 'https://localhost' },
      fetch: spy,
    } as unknown as Window;

    const teardown = installNativeApiBridge(fakeAndroid);
    await fakeAndroid.fetch('/api/events?action=live-chat', { method: 'POST' });
    await fakeAndroid.fetch('https://abc.supabase.co/rest/v1/projects');
    teardown();

    expect(spy).toHaveBeenNthCalledWith(1, 'https://www.tryjalla.com/api/events?action=live-chat', { method: 'POST' });
    expect(spy).toHaveBeenNthCalledWith(2, 'https://abc.supabase.co/rest/v1/projects', undefined);
  });

  it('leaves PDFs and small images untouched in compressImageForUpload', async () => {
    const pdf = new File([new Uint8Array(500_000)], 'receipt.pdf', { type: 'application/pdf' });
    const smallImg = new File([new Uint8Array(100_000)], 'photo.jpg', { type: 'image/jpeg' });
    expect(await compressImageForUpload(pdf)).toBe(pdf);
    expect(await compressImageForUpload(smallImg)).toBe(smallImg);
  });
});
