import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_ACTIONS, stageActions, type StageActionContext, type StageActionKind } from './stage-actions';
import type { StageView } from './workspace';
import { STATE_SEVERITY, stageLifecycle, type StageBlocker, type StageLifecycleState } from '@/lib/lifecycle/stage';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { Payment } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step 5b.2 — the action matrix, and the tab that renders it.
 *
 * Production has no verification, no site update, no funded tranche, no release and no
 * accepted contractor, so every act there is either held with a reason or absent. This
 * is where the full 14-state matrix is exercised: for each derived state, which of the
 * six existing acts is offered, which is live, and — where it is held — that the reason
 * is a sentence the database itself uses, never a new one.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const TAB = 'src/components/admin/workspace/StagesTab.tsx';

const ctx = (over: Partial<StageActionContext> = {}): StageActionContext => ({
  activeVerifiers: 1, contractors: 1, verificationsAvailable: true, ledgerAvailable: true, ...over,
});

type Status = 'locked' | 'active' | 'pending_review' | 'complete';
function view(o: {
  status: Status; state: StageLifecycleState; blockers?: StageBlocker[]; required?: boolean; milestone?: number | null;
  latest?: Partial<StageVerification> | null; tranche?: Partial<Payment> | null; release?: Partial<Payment> | null;
}): StageView {
  return {
    stage: { id: 's', stage_number: 2, status: o.status, verification_required: o.required ?? true, payment_milestone_usd: o.milestone === undefined ? 5000 : o.milestone, completed_at: null } as StageView['stage'],
    substages: [], lifecycle: { state: o.state, blockers: o.blockers ?? [] },
    latestVerification: o.latest ? ({ id: 'v', verifierId: 'ver', decision: 'pending', ...o.latest } as StageVerification) : null,
    verifications: [], siteUpdates: [],
    tranche: o.tranche ? ({ id: 'in', direction: 'in', state: 'expected', amount: 5000, ...o.tranche } as Payment) : null,
    release: o.release ? ({ id: 'out', direction: 'out', state: 'release_authorised', amount: 5000, ...o.release } as Payment) : null,
    certificateId: null, nextStageStarted: false,
  };
}

const summary = (v: StageView, c = ctx()) =>
  Object.fromEntries(stageActions(v, c).filter(a => a.offered).map(a => [a.kind, a.enabled ? 'live' : a.reasonKey]));

describe('the matrix: every derived state, every act', () => {
  it('locked / in_progress / evidence_submitted — nothing to act on yet', () => {
    expect(summary(view({ status: 'locked', state: 'locked' }))).toEqual({});
    expect(summary(view({ status: 'active', state: 'in_progress' }))).toEqual({});
    expect(summary(view({ status: 'active', state: 'evidence_submitted' }))).toEqual({});
  });

  it('rejected (active after a rejection) — the contractor acts, not the desk', () => {
    expect(summary(view({ status: 'active', state: 'rejected', latest: { decision: 'rejected' } }))).toEqual({});
  });

  it('verification_pending, nobody asked — request it; approve is held; rework is open', () => {
    expect(summary(view({ status: 'pending_review', state: 'verification_pending', blockers: ['verifier_not_selected'] }))).toEqual({
      request_verification: 'live',
      approve: 'admin.verification.approveBlocked',
      rework: 'live',
    });
  });

  it('verification_pending with no verifier on the project — held with the existing sentence', () => {
    expect(summary(view({ status: 'pending_review', state: 'verification_pending' }), ctx({ activeVerifiers: 0 })).request_verification)
      .toBe('admin.verification.noVerifiers');
    expect(summary(view({ status: 'pending_review', state: 'verification_pending' }), ctx({ verificationsAvailable: false })).request_verification)
      .toBe('admin.verification.unavailable');
  });

  it('verification_pending / in_progress with an open request — record on behalf', () => {
    for (const state of ['verification_pending', 'verification_in_progress'] as const) {
      const s = summary(view({ status: 'pending_review', state, latest: { decision: 'pending' } }));
      expect(s.record_verification).toBe('live');
      expect(s.request_verification).toBeUndefined();   // there IS an open request
      expect(s.approve).toBe('admin.verification.approveBlocked');
      expect(s.rework).toBe('live');
    }
  });

  it('verified — approve is live, rework still open; not-required stages read verified too', () => {
    expect(summary(view({ status: 'pending_review', state: 'verified', latest: { decision: 'verified' } })))
      .toEqual({ approve: 'live', rework: 'live' });
    expect(summary(view({ status: 'pending_review', state: 'verified', required: false })))
      .toEqual({ approve: 'live', rework: 'live' });
  });

  it('approved · awaiting funding — confirm the expected tranche; release held with insufficient_funds', () => {
    const s = summary(view({ status: 'complete', state: 'approved', blockers: ['awaiting_funding'], tranche: { state: 'expected' } }));
    expect(s).toEqual({ confirm_funding: 'live', authorise_release: 'admin.ledger.refusal.insufficient_funds' });
  });

  it('approved · awaiting funding with NO accepted contractor — the release reason is noContractor (tonny stage 2)', () => {
    const s = summary(view({ status: 'complete', state: 'approved', blockers: ['awaiting_funding'], tranche: { state: 'expected' } }), ctx({ contractors: 0 }));
    expect(s.authorise_release).toBe('admin.ledger.noContractor');
    expect(s.confirm_funding).toBe('live');
  });

  it('approved · awaiting funding with no tranche row — confirm held, says so', () => {
    expect(summary(view({ status: 'complete', state: 'approved', blockers: ['awaiting_funding'] })).confirm_funding)
      .toBe('admin.workspace.stages.noTranche');
  });

  it('approved (funded, verification pending decision) — release held with not_verified', () => {
    expect(summary(view({ status: 'complete', state: 'approved', latest: { decision: 'pending' } })).authorise_release)
      .toBe('admin.ledger.refusal.not_verified');
  });

  it('payment_eligible — authorise is live', () => {
    expect(summary(view({ status: 'complete', state: 'payment_eligible', tranche: { state: 'funded' } })))
      .toEqual({ authorise_release: 'live' });
  });

  it('on hold — release is held with the database’s on_hold reason, whatever else is true', () => {
    expect(summary(view({ status: 'complete', state: 'approved', blockers: ['on_hold', 'awaiting_funding'], tranche: { state: 'expected' } })).authorise_release)
      .toBe('admin.ledger.refusal.on_hold');
  });

  it('release_authorised / disbursement_initiated / disbursed / completed — money is moving or moved; nothing to do here', () => {
    for (const [state, rs] of [['release_authorised', 'release_authorised'], ['disbursement_initiated', 'initiated'], ['disbursed', 'disbursed'], ['completed', 'disbursed']] as const) {
      expect(summary(view({ status: 'complete', state, release: { state: rs } })), state).toEqual({});
    }
  });

  it('payment_failed — a failed row is not live; a new release is offered and the database answers (no guessed reason)', () => {
    expect(summary(view({ status: 'complete', state: 'payment_failed', release: { state: 'failed' }, required: false })).authorise_release)
      .toBe('live');
  });

  it('a stage with no milestone never offers a release — nothing is owed', () => {
    expect(summary(view({ status: 'complete', state: 'completed', milestone: 0 }))).toEqual({});
    expect(summary(view({ status: 'complete', state: 'approved', milestone: null }))).toEqual({});
  });

  it('ledger not applied — the money acts are held with the ledger’s own unavailable sentence', () => {
    const s = summary(view({ status: 'complete', state: 'approved', blockers: ['awaiting_funding'], tranche: { state: 'expected' } }), ctx({ ledgerAvailable: false }));
    expect(s.confirm_funding).toBe('admin.ledger.unavailable');
    expect(s.authorise_release).toBe('admin.ledger.unavailable');
  });

  it('covers every state the lifecycle can return, and every act, without throwing', () => {
    const states = Object.keys(STATE_SEVERITY) as StageLifecycleState[];
    expect(states).toHaveLength(14);
    const seen = new Set<StageActionKind>();
    for (const state of states) for (const status of ['locked', 'active', 'pending_review', 'complete'] as const) {
      const acts = stageActions(view({ status, state }), ctx());
      expect(acts.map(a => a.kind)).toEqual([...STAGE_ACTIONS]);
      for (const a of acts) { if (a.offered) seen.add(a.kind); expect(a.enabled ? a.reasonKey === null : true).toBe(true); }
    }
    // Bare views (no open request, no blocker) reach four acts; the cases above reach the rest.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('agrees with stageLifecycle() end to end for the approved-and-unfunded case', () => {
    const lc = stageLifecycle(
      { id: 's', status: 'complete', stage_number: 2, verification_required: false, payment_milestone_usd: 5000 },
      [], { status: 'active' }, false, null, [],
    );
    const s = summary(view({ status: 'complete', state: lc.state, blockers: lc.blockers, required: false, tranche: { state: 'expected' } }));
    expect(lc).toEqual({ state: 'approved', blockers: ['awaiting_funding'] });
    expect(s).toEqual({ confirm_funding: 'live', authorise_release: 'admin.ledger.refusal.insufficient_funds' });
  });
});

describe('every reason is an existing sentence, in both languages', () => {
  it('reason keys used by the matrix resolve in en and fr', () => {
    const keys = [...src('src/lib/admin/stage-actions.ts').matchAll(/held\('[a-z_]+', '([a-z_.A-Z]+)'\)/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of new Set(keys)) {
      expect(lookup(en, k), k).toBeTypeOf('string');
      expect(lookup(fr, k), k).toBeTypeOf('string');
    }
    // The refusal family is stage_release_blocker()'s own return codes, verbatim.
    const sql = src('supabase/migrations/090_payments_ledger.sql');
    const codes = new Set([...sql.matchAll(/RETURN '([a-z_]+)'/g)].map(m => m[1]));
    for (const r of ['not_complete', 'not_verified', 'insufficient_funds', 'on_hold']) expect(codes.has(r), r).toBe(true);
    for (const r of keys.filter(k => k.startsWith('admin.ledger.refusal.')).map(k => k.split('.').pop() as string)) expect(codes.has(r), r).toBe(true);
  });
});

describe('the tab renders the matrix and writes only through the existing boundaries', () => {
  const c = code(TAB);

  it('reads stageActions() and the assembled view; recomputes nothing', () => {
    expect(c).toContain('stageActions(view, {');
    for (const forbidden of ['stageLifecycle(', 'availableFunds(', 'payment_status', 'supabase.from(', '.rpc(']) expect(c, forbidden).not.toContain(forbidden);
  });

  it('each act calls its existing function and nothing else', () => {
    for (const fn of ['requestVerification(view.stage.id, verifier)', 'recordVerification({', 'adminApproveStage(ws.project.id, view.stage.id', 'adminRequestRework(ws.project.id, view.stage.id', "setLedger({ kind: 'confirm', payment: view.tranche })", "setLedger({ kind: 'authorise', stage: stageRef })"]) {
      expect(c, fn).toContain(fn);
    }
  });

  it('re-reads the workspace after any success and shows a refusal as phrased — no optimistic state', () => {
    expect(c).toContain('await fn();\n      onChanged();');
    expect(c).toContain("onDone={() => { setLedger(null); onChanged(); }}");
    expect(c).toMatch(/setError\(/);
    expect(c).not.toMatch(/setView|setLifecycle|lifecycle:\s*\{\s*state:/);
  });

  it('every held act shows its reason; the loop is six steps in order', () => {
    expect(c).toContain('offered.filter(a => !a.enabled && a.reasonKey)');
    const order = ['admin.workspace.stages.work', 'admin.workspace.stage.evidence', 'admin.workspace.stages.verification', 'admin.workspace.stages.approval', 'admin.workspace.stage.tranche', 'admin.workspace.stage.release'];
    let last = -1;
    for (const k of order) { const at = c.indexOf(`title={t('${k}')}`); expect(at, k).toBeGreaterThan(last); last = at; }
  });

  it('says verification, never inspection', () => {
    expect(code(TAB)).not.toMatch(/inspection/i);
    for (const k of ['admin.workspace.stages.work', 'admin.workspace.stages.verification', 'admin.workspace.stages.approval', 'admin.workspace.stages.approve', 'admin.workspace.stages.noTranche', 'admin.workspace.stages.readyToApprove']) {
      const e = lookup(en, k), f = lookup(fr, k);
      expect(e, k).toBeTypeOf('string'); expect(f, k).toBeTypeOf('string'); expect(e).not.toBe(f);
      expect(e).not.toMatch(/inspect/i);
    }
  });

  it('the ladder selects within the stages tab, and the route wires the tab with reload', () => {
    expect(c).toContain('tab="stages"');
    const route = code('src/app/routes/admin/projects.detail.tsx');
    expect(route).toContain('<StagesTab loaded={loaded} stageId={stageId} onChanged={reload} />');
  });
});
