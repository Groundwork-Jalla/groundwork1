import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionLabel, actionLabelKey, entityTab } from './action-labels';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Every action the database can write has a sentence in both languages.
 *
 * The migrations are the source of truth: each `log_activity(project, 'action', …)` and
 * each literal `action` column in an INSERT is collected here, plus the one dynamic form
 * 090 writes (`'payment.' || state`), and each must resolve to a real label rather than
 * to "updated the project". A label missing here is a row an admin reads and cannot act
 * on — the Activity tab exists to say what happened, not that something did.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

function actionsWrittenByTheDatabase(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    // The first argument may itself be a call with commas (091: `COALESCE(p_project, …)`).
    for (const m of sql.matchAll(/log_activity\(\s*(?:[^,()]|\([^)]*\))+,\s*'([a-z_.]+)'/g)) out.add(m[1]);
    // Direct inserts with a literal action in second position (060/062 `tier_changed`).
    for (const m of sql.matchAll(/INSERT INTO public\.project_audit_log\s*\([^)]*\)\s*VALUES\s*\(\s*[^,]+,\s*'([a-z_.]+)'/g)) out.add(m[1]);
    // 090: `CASE WHEN v_next = 'funded' THEN 'funding.received' ELSE 'payment.' || v_next END`
    if (/'payment\.' \|\| v_next/.test(sql)) {
      for (const st of ['initiated', 'disbursed', 'failed', 'reconciling']) out.add(`payment.${st}`);
    }
  }
  return out;
}

function actionsWrittenByTheApp(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
      const src = readFileSync(p, 'utf8');
      // `action: 'x'` in an audit-row literal; `send` is the CRM's, not the audit log's.
      for (const m of src.matchAll(/\baction:\s*'([a-z_]+(?:\.[a-z_]+)?)'/g)) if (m[1] !== 'send') out.add(m[1]);
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'api'));
  return out;
}

describe('every audit action the database writes has a label', () => {
  const actions = [...actionsWrittenByTheDatabase(), ...actionsWrittenByTheApp()];

  it('finds the actions at all — a regex that matches nothing would pass vacuously', () => {
    expect(actions).toContain('verification.requested');
    expect(actions).toContain('payment.release_authorised');
    expect(actions).toContain('payment.disbursed');
    expect(actions).toContain('conversation.resolved');
    expect(actions).toContain('client.provisioned');
    expect(actions.length).toBeGreaterThan(20);
  });

  for (const action of actions) {
    it(`${action} → en + fr`, () => {
      const key = actionLabelKey(action);
      expect(lookup(en, key), `en lacks ${key}`).toBeTypeOf('string');
      expect(lookup(fr, key), `fr lacks ${key}`).toBeTypeOf('string');
    });
  }
});

describe('actionLabel', () => {
  const t = (key: string) => lookup(en, key) ?? key;

  it('flattens the dotted database form onto the dictionary', () => {
    expect(actionLabelKey('verification.requested')).toBe('admin.ops.action.verification_requested');
    expect(actionLabel('verification.requested', t as never)).toBe('requested a verification');
  });

  it('falls back to "other" for an action nobody has translated, never to the raw key', () => {
    expect(actionLabel('something.new', t as never)).toBe('updated the project');
  });
});

describe('entityTab', () => {
  it('routes every entity type the database writes to a workspace tab, or to none on purpose', () => {
    // From `log_activity(_, _, '<entity_type>', …)` across 086–091.
    const written = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
      // The action is a literal or (090) a CASE expression; the entity type follows it.
      for (const m of sql.matchAll(/log_activity\(\s*(?:[^,()]|\([^)]*\))+,\s*(?:'[a-z_.]+'|CASE[\s\S]*?END),\s*'([a-z_]+)'/g)) written.add(m[1]);
    }
    expect([...written].sort()).toEqual([
      'contractor_invite', 'conversation', 'decision', 'payment', 'project_stage',
      'project_verifier', 'site_update', 'stage_verification', 'support_ticket',
    ]);
    expect(entityTab('project_stage')).toBe('stages');
    expect(entityTab('stage_verification')).toBe('stages');
    expect(entityTab('site_update')).toBe('stages');
    expect(entityTab('payment')).toBe('financials');
    expect(entityTab('conversation')).toBe('conversations');
    expect(entityTab('decision')).toBe('conversations');
    expect(entityTab('contractor_invite')).toBe('team');
    expect(entityTab('project_verifier')).toBe('team');
    // Support tickets are Support's, not a workspace tab: no link, by decision.
    expect(entityTab('support_ticket')).toBeNull();
    expect(entityTab(null)).toBeNull();
  });
});
