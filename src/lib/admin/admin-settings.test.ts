import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../../../api/_handlers/admin-settings';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';

/**
 * Slice 14. `app_config` holds the Resend key and the dispatch secret next to the
 * Action Center thresholds, and it is locked for exactly that reason (058: RLS on, no
 * policies, REVOKE ALL). So the risk here is not a missing feature — it is a settings
 * page that quietly becomes a way to read that table.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const server = code('api/_handlers/admin-settings.ts');
const page   = code('src/app/routes/admin/settings.tsx');
const client = code('src/lib/supabase/admin-settings.ts');

/** Every key the migrations put in app_config, so the test notices a new one. */
const ALL_KEYS = [...new Set(
  src('supabase/migrations/058_app_config.sql').match(/key = '([a-z_]+)'/g)!
    .concat(src('supabase/migrations/091_conversations.sql').match(/key = '([a-z_]+)'/g) ?? [])
    .concat(src('supabase/migrations/076_contractor_inquiries.sql').match(/key = '([a-z_]+)'/g) ?? [])
    .map(m => m.replace(/key = '|'/g, '')),
)];

describe('the allowlist is the security model', () => {
  it('exists, and the browser never names a config key', () => {
    expect(server).toContain('const SETTINGS');
    // The id is looked up in the server's own map; a raw key is never honoured.
    expect(server).toContain("req.body?.id");
    expect(server).toContain('hasOwnProperty.call(SETTINGS, id)');
    expect(server).not.toMatch(/req\.body\?\.key|body\.key/);
  });

  it('reads only the allowlisted keys — a secret never enters the query', () => {
    expect(server).toContain('Object.values(SETTINGS).map(s => s.key)');
    expect(server).toContain(".in('key', keys)");
    // No unbounded read of the table anywhere.
    expect(server).not.toMatch(/from\('app_config'\)\s*\.select\([^)]*\)\s*(?!\.in)/);
  });

  it('every secret key is absent from the server, the client and the page', () => {
    const secrets = ['resend_api_key', 'agent_dispatch_secret', 'agent_dispatch_url'];
    for (const key of secrets) {
      expect(server, `${key} must never be in the allowlist`).not.toContain(`'${key}'`);
      expect(client, `${key} must never reach the client`).not.toContain(key);
      expect(page, `${key} must never be rendered`).not.toContain(key);
    }
    // And the classification is exhaustive: every key the migrations create is either
    // allowlisted or named in the comment that says why it is not.
    for (const key of ALL_KEYS) {
      const known = server.includes(`'${key}'`) || src('api/_handlers/admin-settings.ts').includes(key);
      expect(known, `${key} is in app_config but this handler never classified it`).toBe(true);
    }
  });

  it('provider credentials stay with Integrations', () => {
    for (const key of ['ghl_api_token', 'GHL_API_TOKEN', 'ghl_inbound_secret', 'ghl_client_secret', 'GHL_KEYS']) {
      expect(server, `${key} belongs to Integrations`).not.toContain(key);
      expect(page, `${key} belongs to Integrations`).not.toContain(key);
    }
    expect(page, 'and the page says where they live').toContain('/admin/integrations');
  });

  it('is not a generic key/value editor', () => {
    for (const banned of ['newKey', 'addSetting', 'customKey', 'keyName', 'rawKey']) {
      expect(server, banned).not.toContain(banned);
      expect(page, banned).not.toContain(banned);
    }
    // Three settings, and the page renders from a fixed label map.
    expect(page).toContain('const LABEL');
    expect(page).toContain('const SECTIONS');
  });
});

describe('authorization happens on the server', () => {
  it('admin is proved by the RPC, with the caller\'s own token', () => {
    expect(server).toContain("rpc('is_admin')");
    expect(server).toContain("res.status(403)");
    expect(server).toContain("res.status(401)");
    // The service-role client is created only after that check passes.
    expect(server.indexOf("rpc('is_admin')")).toBeLessThan(server.indexOf('createClient(url, serviceKey'));
  });

  it('the service-role key is never sent to the browser', () => {
    expect(client).not.toContain('SERVICE_ROLE');
    expect(page).not.toContain('SERVICE_ROLE');
    expect(client).not.toContain("from('app_config')");
    expect(page).not.toContain("from('app_config')");
  });

  it('is routed through the existing server boundary, not a new function', () => {
    const events = src('api/events.ts');
    expect(events).toContain("'admin-settings'");
    expect(client).toContain('/api/events?action=admin-settings');
  });
});

describe('values are validated before the database', () => {
  it('an email must look like one', () => {
    expect(validate('email', 'team@tryjalla.com')).toEqual({ ok: true, value: 'team@tryjalla.com' });
    expect(validate('email', ' team@tryjalla.com ')).toEqual({ ok: true, value: 'team@tryjalla.com' });
    for (const bad of ['', 'team', 'team@', '@tryjalla.com', 'a b@c.com', 'team@localhost']) {
      expect(validate('email', bad).ok, bad).toBe(false);
    }
    expect(validate('email', 123).ok).toBe(false);
  });

  it('hours are whole and within a defensible range', () => {
    expect(validate('hours', '4')).toEqual({ ok: true, value: '4' });
    expect(validate('hours', '168').ok).toBe(true);
    for (const bad of ['0', '-1', '169', '4.5', 'four', '', 'NaN', 'Infinity']) {
      expect(validate('hours', bad).ok, bad).toBe(false);
    }
  });

  it('bands must be complete, integral and ascending', () => {
    const good = validate('bands', '{"medium":4,"high":8,"critical":24}');
    expect(good.ok).toBe(true);
    if (good.ok) expect(JSON.parse(good.value)).toEqual({ medium: 4, high: 8, critical: 24 });

    // A critical band below the high one would classify everything as critical.
    expect(validate('bands', '{"medium":4,"high":24,"critical":8}').ok).toBe(false);
    expect(validate('bands', '{"medium":4,"high":4,"critical":24}').ok).toBe(false);
    for (const bad of [
      'not json', '[]', '{}', '{"medium":4,"high":8}',
      '{"medium":4,"high":8,"critical":24,"extra":48}',
      '{"medium":"4","high":8,"critical":24}',
      '{"medium":0,"high":8,"critical":24}',
      '{"medium":4,"high":8,"critical":999}',
    ]) {
      expect(validate('bands', bad).ok, bad).toBe(false);
    }
  });

  it('an unknown setting id is refused before any database client exists', () => {
    expect(server).toContain("error: 'unknown_setting'");
    expect(server).toContain("error: 'not_editable'");
    expect(server.indexOf("unknown_setting")).toBeLessThan(server.indexOf("from('app_config')"));
  });
});

describe('the page shows what is stored, not what it sent', () => {
  it('a write is followed by a read of the whole allowlist', () => {
    // The comment lives in the source; `server` has comments stripped.
    expect(src('api/_handlers/admin-settings.ts')).toContain('Read back, always');
    // The response is built from the fresh read, never from req.body.
    const readIndex = server.lastIndexOf("from('app_config')");
    expect(server.indexOf('res.status(200).json({ ok: true, settings })')).toBeGreaterThan(readIndex);
    expect(client).toContain('saveSetting');
    expect(page).toContain('onSaved(await saveSetting(');
  });

  it('a missing row is "not set", never the reader\'s fallback', () => {
    expect(server).toContain('value: row ? String(row.value) : null');
    expect(page).toContain('setting.value === null');
    expect(page).toContain('admin.settings.notSet.');
    // The fallback is named as a fallback in the copy, not printed into the input.
    expect(String(lookup(en, 'admin.settings.notSet.unansweredHours'))).toMatch(/falls back/i);
    expect(String(lookup(en, 'admin.settings.notSet.unansweredHours'))).toMatch(/not a choice/i);
  });

  it('unreadable is its own state', () => {
    expect(page).toContain('rows === null');
    expect(page).toContain('admin.settings.unreadable');
    expect(lookup(en, 'admin.settings.unreadable')).toBeTypeOf('string');
  });

  it('a refused value is reported with the server\'s reason', () => {
    expect(page).toContain('admin.settings.rejected');
    expect(String(lookup(en, 'admin.settings.rejected'))).toContain('{reason}');
  });
});

describe('the route is real and the placeholder is gone', () => {
  it('registered, and ahead of the catch-all', () => {
    const routes = src('src/app/routes.ts');
    expect(routes).toContain('"admin/settings"');
    expect(routes).toContain('"routes/admin/settings.tsx"');
    // The `admin/:section` catch-all would otherwise swallow it.
    expect(routes.indexOf('"admin/settings"')).toBeLessThan(routes.indexOf('"admin/:section"'));
    expect(ADMIN_PLACEHOLDERS['settings']).toBeUndefined();
  });

  it('the remaining placeholders are the schema-blocked ones', () => {
    for (const key of ['tasks', 'inspections', 'agents', 'site-managers']) {
      expect(ADMIN_PLACEHOLDERS[key], key).toBeDefined();
    }
  });
});

describe('EN and FR carry every new string', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.settings.title', 'admin.settings.subtitle', 'admin.settings.unreadable',
      'admin.settings.communication', 'admin.settings.actionCenter', 'admin.settings.actionCenterSub',
      'admin.settings.notHere', 'admin.settings.notHereBody', 'admin.settings.toIntegrations',
      'admin.settings.notifyEmail.name', 'admin.settings.notifyEmail.help',
      'admin.settings.unansweredHours.name', 'admin.settings.unansweredHours.help',
      'admin.settings.unansweredBands.name', 'admin.settings.unansweredBands.help',
      'admin.settings.notSet.notifyEmail', 'admin.settings.notSet.unansweredHours',
      'admin.settings.notSet.unansweredBands', 'admin.settings.unitHours', 'admin.settings.readOnly',
    ];
    const sameInBoth = ['admin.settings.communication'];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      if (!sameInBoth.includes(key)) expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
