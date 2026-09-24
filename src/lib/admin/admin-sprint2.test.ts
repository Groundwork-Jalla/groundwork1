import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { ADMIN_NAV, ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';

/**
 * The second completion sprint: Integrations, Support → Inbox, Team & permissions,
 * Analytics, and the channel entries in the sidebar.
 *
 * Every pin here guards the same line: a screen may only show what a table actually
 * holds. An integration that is not configured says so; a ticket with no thread says so;
 * a count that could not be read is not zero; and a page with no history behind it does
 * not draw a trend.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the three new pages are real destinations', () => {
  it('each is routed, reachable, and no longer a placeholder', () => {
    const routes = src('src/app/routes.ts');
    for (const [path, file] of [
      ['admin/integrations', 'routes/admin/integrations.tsx'],
      ['admin/team', 'routes/admin/team.tsx'],
      ['admin/analytics', 'routes/admin/analytics.tsx'],
    ]) {
      expect(routes, path).toContain(`"${path}"`);
      expect(routes, file).toContain(`"${file}"`);
    }
    for (const key of ['integrations', 'team', 'analytics', 'messages', 'email', 'calls']) {
      expect(ADMIN_PLACEHOLDERS[key], `${key} is built and must not be a placeholder`).toBeUndefined();
    }
    // The ones with no entity behind them are still honest placeholders, not empty pages.
    for (const key of ['tasks', 'inspections', 'agents', 'site-managers']) {
      expect(ADMIN_PLACEHOLDERS[key], `${key} has no entity and must stay a placeholder`).toBeDefined();
    }
  });

  it('the channel entries open the Inbox filtered, not four separate screens', () => {
    for (const channel of ['whatsapp', 'email', 'call', 'jalla']) {
      const item = ADMIN_NAV.find(i => i.to === `/admin/inbox?channel=${channel}`);
      expect(item, `${channel} must point at the one Inbox`).toBeDefined();
    }
    // One store, one screen: no route may exist for a per-channel page.
    const routes = src('src/app/routes.ts');
    for (const path of ['admin/whatsapp', 'admin/email', 'admin/calls', 'admin/messages']) {
      expect(routes, `${path} would split the conversation store`).not.toContain(`"${path}"`);
    }
  });

  it('the Inbox reads the channel filter it is sent', () => {
    const inbox = code('src/app/routes/admin/inbox.tsx');
    expect(inbox).toContain("'channel'");
    expect(inbox).toMatch(/searchParams|useSearchParams/);
  });
});

describe('integrations reports configuration, it does not assume it', () => {
  const page = code('src/app/routes/admin/integrations.tsx');

  it('the SwyChr card is full enough to balance the page and still says nothing untrue', () => {
    // Four rows, every one of them "not configured" — presentation, not a state read.
    expect(page).toContain('swychr.credentials');
    expect(page).toContain('swychr.endpoint');
    expect(page).toContain('swychr.reconciliation');
    expect(page).toMatch(/health="off"/);
    for (const banned of ['uptime', 'Uptime', 'healthy', 'Healthy', 'wallet', 'Wallet', 'escrow', 'Escrow', 'balance', 'Balance', 'Connect', 'Retry', 'Test connection']) {
      expect(page, `${banned} would imply a connection that does not exist`).not.toContain(banned);
    }
  });

  it('reads live settings rather than hard-coding a state', () => {
    expect(page).toMatch(/ghl|Ghl|GHL/);
    // A card must be able to say "not configured" — the SwyChr one always does today.
    expect(page).toMatch(/notConfigured|not_configured/);
  });

  it('never prints a secret or a token value', () => {
    expect(page).not.toMatch(/process\.env\.[A-Z_]*(SECRET|KEY|TOKEN)/);
  });
});

describe('a support ticket is answered in Groundwork, not in a mail client', () => {
  const page = code('src/app/routes/admin/support.tsx');

  it('opens the person\'s conversation instead of composing an email', () => {
    expect(page).not.toContain('mailto:');
    expect(page).toContain('/admin/inbox?conversation=');
  });

  it('records that the ticket is about that conversation', () => {
    expect(page).toContain('linkTicket');
  });

  it('says so honestly when there is no thread, rather than offering a dead action', () => {
    expect(page).toMatch(/noThread/);
    // 091 absent is a different fact from "this person has never written in", which is
    // a different fact again from a link pointing at something unreadable.
    expect(page).toMatch(/inboxUnavailable/);
    expect(page).toMatch(/threadUnreadable/);
  });

  it('never resolves a person to a thread by sort order', () => {
    // The screen delegates the decision; it does not re-implement it. Anything that
    // reduces a person's threads to one on this page would be a second, untested rule.
    expect(page).toContain('ticketThread(');
    // The page may ORDER threads for a human to read (byRecency) but may never compare
    // them to pick one. `.sort(` itself is legitimate here — it puts account-deletion
    // tickets first — so what is banned is comparing message times at all.
    for (const banned of ['lastMessageAt >', 'lastMessageAt <', 'lastMessageAt ?? ', 'newest']) {
      expect(page, `${banned} would be picking a thread on the page`).not.toContain(banned);
    }
  });

  it('keeps every thread a person has, so the chooser has something to show', () => {
    expect(page).toContain('Map<string, Conversation[]>');
    expect(page).toContain('ThreadChooser');
    // The chooser must be enough to tell two threads apart without opening either.
    expect(page).toContain('listConversationPreviews');
    expect(page).toContain('projectContext');
  });

  it('choosing links the ticket through the existing RPC path', () => {
    expect(page).toContain('onPick');
    expect(page).toContain('noteLink');
    // No new store: the chooser must not create a conversation to have one to open.
    for (const banned of ['ensureProjectConversation', 'ensure_inbound_conversation', 'createConversation']) {
      expect(page, `${banned} would invent a thread rather than admit there is none`).not.toContain(banned);
    }
  });
});

describe('team & permissions shows roles, it does not become a second role store', () => {
  const page = code('src/app/routes/admin/team.tsx');

  it('reads the existing admin user list', () => {
    expect(page).toContain('listAdminUsers');
  });

  it('does not write roles from this screen', () => {
    for (const forbidden of ['user_roles', 'grantRole', 'assignRole', '.insert(', '.update(']) {
      expect(page, `${forbidden} would make this a second place roles are set`).not.toContain(forbidden);
    }
  });
});

describe('analytics counts what exists and refuses to imply a trend', () => {
  const loader = code('src/lib/supabase/admin-analytics.ts');
  const page = code('src/app/routes/admin/analytics.tsx');

  it('an unreadable domain comes back null, never zero', () => {
    expect(loader).toMatch(/\|\s*null/);
    for (const domain of ['finance', 'verification', 'communication', 'field']) {
      expect(loader, `${domain} must be nullable`).toMatch(new RegExp(`${domain}:[^\\n]*\\|\\s*null`));
    }
  });

  it('the page renders null as unavailable rather than as a figure', () => {
    expect(page).toContain('Unavailable');
    for (const domain of ['finance', 'verification', 'communication', 'field']) {
      expect(page, `${domain} must have a null branch`).toContain(`${domain} === null`);
    }
  });

  it('draws no growth percentage and no time series', () => {
    // The one legitimate mention is the footnote saying why there are no trends.
    expect(page).toContain('noTrends');
    const body = page.replace(/noTrends/g, '');
    for (const forbidden of ['growth', 'Growth', 'trend', 'Trend', 'lastMonth', 'previous', 'delta', 'vs.']) {
      expect(body, `${forbidden} would need history Groundwork does not keep`).not.toContain(forbidden);
    }
  });

  it('bars are a share of a real total, so a zero total draws nothing', () => {
    expect(page).toMatch(/total === 0/);
    // The meter divides by the largest value present, which can itself be zero.
    expect(page).toMatch(/max > 0/);
  });

  it('draws the current-state visualisations from the loader\'s own numbers', () => {
    expect(page).toContain('<Meter');
    for (const figure of ['finance.expected', 'finance.funded', 'finance.authorised', 'finance.disbursed']) {
      expect(page, `${figure} must be drawn, not described`).toContain(figure);
    }
    // Verification, communication and acquisition are counts on the same treatment.
    expect((page.match(/<Counts/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('labels say which population they counted', () => {
    // Archived projects are excluded by the loader, so the word "Projects" alone lies.
    expect(lookup(en, 'admin.analytics.projects')).toBe('Active projects');
    expect(lookup(en, 'admin.analytics.verification')).toMatch(/All-time/);
    expect(lookup(en, 'admin.analytics.verificationSub')).toMatch(/lifetime/i);
    expect(code('src/lib/supabase/admin-analytics.ts')).toContain("neq('status', 'archived')");
  });

  it('a null or missing bucket key renders as a word, never a raw key or NaN', () => {
    expect(page).toContain('unknownKey');
    expect(page).toContain('noStage');
    expect(page).toContain('Number.isFinite');
    expect(lookup(en, 'admin.analytics.unknownKey')).toBe('Unknown');
  });

  it('reuses the financial engine instead of summing money a second way', () => {
    expect(loader).toMatch(/financialTotals|financialRows/);
  });
});

describe('EN and FR carry every new string', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.integrations.title', 'admin.integrations.subtitle',
      'admin.team.title', 'admin.team.subtitle',
      'admin.support.openThread', 'admin.support.noThread', 'admin.support.inboxUnavailable',
      'admin.analytics.title', 'admin.analytics.subtitle', 'admin.analytics.noTrends',
      'admin.analytics.finance', 'admin.analytics.verification', 'admin.analytics.acquisition',
      'admin.analytics.field', 'admin.analytics.openInbox', 'admin.analytics.unknownKey',
    ];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      // A handful of words are spelled the same in both languages.
      if (!['admin.integrations.title', 'admin.analytics.communication'].includes(key)) {
        expect(e, `${key} is not translated`).not.toBe(f);
      }
    }
  });
});
