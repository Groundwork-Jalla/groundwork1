import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { stageActions, type StageActionContext } from '@/lib/admin/stage-actions';
import { BANKS, banksFor, bankName } from '@/lib/payments/banks';
import { maskDestination } from '@/lib/payments/payout-destination';

/**
 * Paying the contractor assigned to a project (101), and collecting their details when they
 * onboard (099).
 *
 * The rules worth pinning are not in the markup: WHERE the numbers may appear, WHAT the
 * release does when there is nowhere to send money, and that no screen invents its own
 * answer to "is this account usable". Most of it is a source scan because none of it is
 * visible to tsc.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');

const MIGRATION = 'supabase/migrations/101_primary_contractor_payout.sql';
const DATA      = 'src/lib/supabase/payout-destinations.ts';
const PAGE      = 'src/app/routes/work/payouts.tsx';
const CHECK     = 'src/components/admin/team/ContractorPayoutCheck.tsx';

describe('the numbers stay where they belong', () => {
  it('shows a person a masked account, never the stored value', () => {
    // Both surfaces that render a destination go through maskDestination. A screen printing
    // `d.accountNumber` would put a full account number in every screenshot and support
    // thread that followed.
    for (const f of [PAGE, CHECK]) {
      const src = code(f);
      expect(src, `${f} does not mask`).toMatch(/maskDestination/);
      expect(src, `${f} renders a raw number`).not.toMatch(/\{\s*d\.accountNumber\s*\}/);
      expect(src, `${f} renders a raw number`).not.toMatch(/\{\s*d\.mobileNo\s*\}/);
    }
  });

  it('masks enough to recognise and not enough to use', () => {
    const m = maskDestination({ method: 'mobile_money', mobileNo: '+237670123456', accountNumber: null, bankKey: null });
    expect(m).toContain('456');
    expect(m).not.toContain('670123');
    const b = maskDestination({ method: 'bank', mobileNo: null, accountNumber: '10005000123456789', bankKey: 'afriland' });
    expect(b).toContain('6789');
    expect(b).not.toContain('000123456');
  });

  it('keeps account numbers out of the staff-readable audit log', () => {
    const sql = read(MIGRATION);
    // 101 logs the destination's id and method. If it ever logged the row itself, every
    // account number would be readable by anyone who can read project activity.
    expect(sql).toMatch(/'destination_id', v_dest/);
    expect(sql).not.toMatch(/log_activity[\s\S]{0,400}account_number/);
    expect(sql).not.toMatch(/log_activity[\s\S]{0,400}mobile_no/);
  });

  it('never returns account digits from project_payout_target', () => {
    const target = read(MIGRATION).match(/FUNCTION public\.project_payout_target[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(target).not.toMatch(/account_number|mobile_no|bank_key/);
  });
});

describe('stored is not usable', () => {
  it('asks the database whether money may be sent, and never decides locally', () => {
    const sql = read(MIGRATION);
    // 099's payout_destination_eligible is the single authority. A second rule here — a
    // `status = 'verified'` test written into 101 — is exactly the drift 099 warned about.
    expect(sql).toMatch(/payout_destination_eligible\(/);
    const resolver = sql.match(/FUNCTION public\.contractor_payout_destination[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(resolver).toMatch(/payout_destination_eligible/);
    expect(resolver).not.toMatch(/status\s*=\s*'verified'/);
  });

  it('offers no way for a contractor to mark their own details checked', () => {
    // verify_payout_destination is staff-only in 099. The contractor's own page must not
    // call it, or the whole check is theatre.
    expect(code(PAGE)).not.toMatch(/verifyPayoutDestination|verify_payout_destination/);
    expect(code(CHECK)).toMatch(/verifyPayoutDestination/);
  });

  it('writes only through the RPCs, since the table grants no direct write', () => {
    const d = code(DATA);
    for (const rpc of ['add_payout_destination', 'set_default_payout_destination',
                       'retire_payout_destination', 'verify_payout_destination']) {
      expect(d).toContain(rpc);
    }
    expect(d).not.toMatch(/from\('payout_destinations'\)[\s\S]{0,120}\.(insert|update|delete)\(/);
  });

  it('sends only the chosen method’s fields, which is what 099’s shape CHECK requires', () => {
    const d = code(DATA);
    expect(d).toMatch(/p_mobile:\s*mobile \?/);
    expect(d).toMatch(/p_bank_key:\s*mobile \? null/);
  });
});

describe('a release cannot be authorised into thin air', () => {
  const sql = read(MIGRATION);

  it('refuses when the beneficiary has nowhere eligible to be paid', () => {
    const fn = sql.match(/FUNCTION public\.authorise_release[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/contractor_payout_blocker\(p_beneficiary\)/);
    expect(fn).toMatch(/no_payout_destination:/);
    // And the refusal comes BEFORE the insert, so no row is written for a payment that
    // cannot say where it goes.
    expect(fn.indexOf('no_payout_destination')).toBeLessThan(fn.indexOf('INSERT INTO public.payments'));
  });

  it('records the destination it resolved on the payment row', () => {
    const fn = sql.match(/FUNCTION public\.authorise_release[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/destination_id/);
    expect(fn).toMatch(/v_dest := public\.contractor_payout_destination\(p_beneficiary\)/);
  });

  it('keeps the four parameters 090 granted, so every existing caller still works', () => {
    expect(sql).toMatch(/FUNCTION public\.authorise_release\(p_stage uuid, p_amount numeric, p_beneficiary uuid, p_note text DEFAULT NULL\)/);
  });
});

describe('one primary contractor per project', () => {
  const sql = read(MIGRATION);

  it('is enforced by an index, not by the application remembering', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_one_primary[\s\S]{0,120}WHERE is_primary = true/);
  });

  it('cannot be somebody who has not accepted, or who has no account', () => {
    const fn = sql.match(/FUNCTION public\.set_primary_contractor[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/not_accepted/);
    expect(fn).toMatch(/no_account/);
    // An accountless invite has nowhere money could go — payout destinations are keyed on
    // the account, so naming one primary would look settled and pay nobody.
    expect(fn).toMatch(/contractor_user_id IS NULL/);
  });

  it('is stood down automatically when the assignment ends', () => {
    const trg = sql.match(/FUNCTION public\.contractor_invites_clear_primary[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(trg).toMatch(/NEW\.status <> 'accepted'[\s\S]{0,60}is_primary := false/);
    expect(trg).toMatch(/contractor_user_id IS NULL[\s\S]{0,60}is_primary := false/);
  });

  it('is named by staff or the project owner, never by the contractor', () => {
    const fn = sql.match(/FUNCTION public\.set_primary_contractor[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/is_admin\(\) OR v_owner = auth\.uid\(\)/);
    expect(fn).toMatch(/not_authorized/);
  });
});

describe('the admin is told why a release is held, before clicking', () => {
  const base: StageActionContext = {
    activeVerifiers: 1, contractors: 1,
    verificationsAvailable: true, ledgerAvailable: true,
  };
  // A complete stage that owes money and has no live release — the state in which the
  // release row is offered at all.
  const view = {
    stage: { id: 's', status: 'complete', payment_milestone_usd: 500 },
    lifecycle: { state: 'payment_eligible', blockers: [] as string[] },
    latestVerification: { decision: 'verified' },
    tranche: { state: 'funded' },
    release: null,
  } as unknown as Parameters<typeof stageActions>[0];

  const release = (ctx: StageActionContext) =>
    stageActions(view, ctx).find(a => a.kind === 'authorise_release')!;

  it('holds the release with the reason when the contractor has no details', () => {
    const a = release({ ...base, payoutBlocker: 'no_details' });
    expect(a.offered).toBe(true);
    expect(a.enabled).toBe(false);
    expect(a.reasonKey).toBe('admin.ledger.payout.no_details');
  });

  it('holds it when details are on file but nobody has checked them', () => {
    expect(release({ ...base, payoutBlocker: 'unverified' }).reasonKey)
      .toBe('admin.ledger.payout.unverified');
  });

  it('allows it once the blocker is null', () => {
    const a = release({ ...base, payoutBlocker: null });
    expect(a.enabled).toBe(true);
    expect(a.reasonKey).toBeNull();
  });

  it('leaves the release to the database when the lookup has not answered yet', () => {
    // undefined is "not looked up". Treating it as null would say "cleared to send" on the
    // strength of a request that has not come back.
    const a = release({ ...base });
    expect(a.enabled).toBe(true);
  });

  it('has wording for every reason the database can give, in both languages', () => {
    for (const reason of ['no_contractor', 'no_details', 'no_default', 'unverified']) {
      const e = (en.admin as Record<string, any>).ledger.payout[reason];
      const f = (fr.admin as Record<string, any>).ledger.payout[reason];
      expect(e, `en lacks ${reason}`).toBeTypeOf('string');
      expect(f, `fr lacks ${reason}`).toBeTypeOf('string');
    }
  });
});

describe('the bank list is a stable key, not a guessed code', () => {
  it('stores a slug, because the provider’s code list is not known yet', () => {
    // A plausible-looking wrong account code is money sent nowhere, found days later.
    for (const b of BANKS) expect(b.slug).toMatch(/^[a-z][a-z0-9]*$/);
  });

  it('has no duplicate slugs, which would silently merge two banks', () => {
    expect(new Set(BANKS.map(b => b.slug)).size).toBe(BANKS.length);
  });

  it('covers the launch corridor and resolves a slug to a name', () => {
    expect(banksFor('CM').length).toBeGreaterThan(5);
    expect(bankName('afriland')).toBe('Afriland First Bank');
    // An unknown slug reads back as itself rather than an empty cell.
    expect(bankName('somethingelse')).toBe('somethingelse');
  });
});

describe('what the contractor is told', () => {
  it('never says Groundwork holds the money, in either language', () => {
    const BANNED = /escrow|wallet|held securely|we hold|in trust|custody|séquestre|portefeuille/i;
    const copy = JSON.stringify([
      (en as Record<string, unknown>).contractorPayout,
      (fr as Record<string, unknown>).contractorPayout,
    ]);
    expect(copy).not.toMatch(BANNED);
  });

  it('names no payment provider to the contractor', () => {
    const copy = JSON.stringify([
      (en as Record<string, unknown>).contractorPayout,
      (fr as Record<string, unknown>).contractorPayout,
    ]);
    expect(copy).not.toMatch(/swychr|stripe|gohighlevel|\bghl\b/i);
  });

  it('has full EN/FR parity', () => {
    const keys = (o: unknown, prefix = ''): string[] =>
      typeof o === 'object' && o !== null
        ? Object.entries(o).flatMap(([k, v]) =>
            typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
        : [];
    const e = keys((en as Record<string, unknown>).contractorPayout);
    const f = keys((fr as Record<string, unknown>).contractorPayout);
    expect(e.length).toBeGreaterThan(20);
    expect(f.sort()).toEqual(e.sort());
  });
});

describe('the contractor surface keeps its boundaries', () => {
  it('reaches no admin RPC from the payout page', () => {
    const src = code(PAGE);
    for (const rpc of ['is_admin', 'admin_', 'authorise_release', 'set_primary_contractor',
                       'verify_payout_destination', 'confirm_funding']) {
      expect(src, `${PAGE} references ${rpc}`).not.toContain(rpc);
    }
  });

  it('lives under /work, the contractor’s own surface', () => {
    expect(code('src/app/routes.ts')).toMatch(/route\("work\/payouts",\s+"routes\/work\/payouts\.tsx"\)/);
  });

  it('is reachable from the contractor’s navigation', () => {
    expect(code('src/components/shell/WorkShell.tsx')).toMatch(/\/work\/payouts/);
  });
});

describe('the bank field is named for what it holds', () => {
  const SQL = read(MIGRATION);

  it('renames 099’s bank_code, which meant a provider routing code', () => {
    // `createPayout()` passes its bankCode argument straight into SwyChr's
    // `create_transaction` as `bank_code`. A Groundwork slug in a column of that name is an
    // invitation to send `uba` where a routing number belongs.
    expect(SQL).toMatch(/RENAME COLUMN bank_code TO bank_key/);
    expect(SQL).toMatch(/p_bank_key text DEFAULT NULL/);
  });

  it('leaves the provider’s own name free for the provider’s own code', () => {
    // No new bank_code column is created here. It is reserved.
    expect(SQL).not.toMatch(/ADD COLUMN IF NOT EXISTS bank_code/);
    expect(SQL).toMatch(/reserved for SwyChr/);
  });

  it('never hands our key to the provider call', () => {
    // The outbound client's field is `bankCode`; ours is `bankKey`. They must not be wired
    // together without a mapping, and no mapping exists yet.
    const client = read('api/swychr/_client.ts');
    expect(client).toMatch(/bank_code: req\.bankCode/);
    expect(client).not.toMatch(/bankKey|bank_key/);
  });

  it('keeps the two names apart in TypeScript too', () => {
    const pure = code('src/lib/payments/payout-destination.ts');
    expect(pure).toMatch(/bankKey: string \| null;/);
    expect(pure).not.toMatch(/bankCode/);
  });
});

describe('the outbound payout must use the snapshotted destination', () => {
  const SQL = read(MIGRATION);
  const fn = SQL.match(/FUNCTION public\.payout_initiation_target[\s\S]*?END \$\$;/)?.[0] ?? '';

  it('derives the destination from the payment row, not from the contractor', () => {
    // The failure this prevents: admin authorises to A, contractor switches default to B,
    // handler sends the authorised release to B. Nobody approved B.
    expect(fn).toMatch(/v_pay\.destination_id/);
    expect(fn).not.toMatch(/is_default/);
  });

  it('cannot be asked the wrong question — it takes no destination argument', () => {
    expect(SQL).toMatch(/FUNCTION public\.payout_initiation_target\(p_payment uuid\)/);
  });

  it('rechecks that the destination still belongs to the beneficiary', () => {
    expect(fn).toMatch(/v_dest\.owner_id IS DISTINCT FROM v_pay\.beneficiary_id/);
    expect(fn).toMatch(/beneficiary_mismatch/);
  });

  it('fails closed when the snapshot is no longer eligible', () => {
    // Retired between authorisation and payout: refuse. Never substitute another default.
    expect(fn).toMatch(/NOT public\.payout_destination_eligible/);
    expect(fn).toMatch(/destination_not_eligible/);
  });

  it('refuses a release that carries no snapshot at all', () => {
    expect(fn).toMatch(/no_destination_snapshot/);
  });

  it('refuses anything already sent, so a payout cannot be made twice', () => {
    expect(fn).toMatch(/v_pay\.state <> 'release_authorised'/);
    expect(fn).toMatch(/wrong_state/);
  });

  it('is server-only, because account numbers come out of it', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.payout_initiation_target\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT  EXECUTE ON FUNCTION public\.payout_initiation_target\(uuid\) TO service_role;/);
  });
});

describe('a verified destination can be retired', () => {
  it('fixes 099’s constraint, which made retiring a checked account impossible', () => {
    // 099: CHECK ((status = 'verified') = (verified_at IS NOT NULL)). `retire_payout_destination`
    // sets status='retired' and leaves verified_at, so the equality failed and the row could
    // not be stood down — leaving a closed bank account eligible for payouts.
    const SQL = read(MIGRATION);
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS payout_destination_verified_dated/);
    expect(SQL).toMatch(/CHECK \(status <> 'verified' OR verified_at IS NOT NULL\)/);
  });
});

describe('what the primary-contractor flag does and does not guarantee', () => {
  const SQL = read(MIGRATION);

  it('says plainly that contractor removal is not modelled', () => {
    // contractor_invites.status is pending|accepted|rejected. There is no removal state, so
    // "cleared when the assignment ends" would be claiming an invariant the schema cannot
    // express. The comment must not overstate it.
    expect(SQL).toMatch(/no removal state/);
    expect(SQL).toMatch(/removal is NOT modelled/);
  });

  it('still proves the four things the schema CAN express', () => {
    expect(SQL).toMatch(/CHECK \(NOT is_primary OR status = 'accepted'\)/);
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_one_primary[\s\S]{0,120}WHERE is_primary = true/);
    expect(SQL).toMatch(/IF NEW\.status <> 'accepted' THEN NEW\.is_primary := false; END IF;/);
    expect(SQL).toMatch(/not_accepted: this contractor has not accepted/);
  });
});
