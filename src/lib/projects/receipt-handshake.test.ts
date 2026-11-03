import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Approve → receipt → confirm → unlock (175).
 *
 * Favour, 3 Nov 2026: "Once they click approve stage, the next thing that should show
 * is upload payment receipt. For next stage, and when they upload it, the contractor
 * should be able to receive it and see it. And the contractor will now click confirm.
 * When the contractor confirms, then that stage unlocks automatically."
 *
 * Three acts by three different people, and the value is entirely in them being
 * separate. Every test below pins one way the separation could collapse — each of
 * which leaves a system that still works, still opens stages, and no longer means
 * anything.
 */

const sql = readFileSync('supabase/migrations/175_receipt_then_contractor_confirms.sql', 'utf8');

describe('the regression 174 introduced is repaired', () => {
  /**
   * 174 rebuilt approve_stage from 087's body when 132's was current, which put back
   * the behaviour 132 existed to remove: the next stage opening on approval alone,
   * paid or not. CREATE OR REPLACE across two migrations gives no warning — the older
   * body simply wins.
   */
  it('approval defers to funding again', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.approve_stage('));
    expect(fn).toMatch(/IF public\.stage_funding_settled\(v_next\.id\) THEN/);
    expect(fn).toMatch(/stage\.awaiting_payment/);
  });

  it('and the rest of 132 that 174 dropped is back', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.approve_stage('));
    expect(fn).toMatch(/completed_at = v_now/);
    expect(fn).toMatch(/v_final := \(v_stage\.stage_number \+ 1 > 10\)/);
    expect(fn).toMatch(/'next_stage_id',\s*v_next\.id/);
  });

  it('while keeping what 174 added', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.approve_stage('));
    expect(fn).toMatch(/public\.is_project_client\(/);
    expect(fn).toMatch(/no_evidence: this stage has nothing uploaded to review yet/);
  });
});

describe('a receipt is claimed money, not received money', () => {
  it('receipt_submitted is a state of its own', () => {
    expect(sql).toMatch(/state IN \('expected', 'receipt_submitted', 'funded', 'reconciled'\)/);
  });

  it('and does NOT settle the stage', () => {
    /**
     * The single most important line in the migration. If `receipt_submitted` settled
     * the stage, uploading the receipt would open it, and the contractor's confirm
     * button would be decoration — a client could advance their own build with a
     * photograph of nothing.
     */
    const fn = sql.slice(sql.indexOf('FUNCTION public.stage_funding_settled('));
    expect(fn.slice(0, 900)).toMatch(/state IN \('expected', 'receipt_submitted'\)/);
  });

  it('and cannot exist without the proof attached', () => {
    expect(sql).toMatch(/state <> 'receipt_submitted'\s*\n\s*OR \(receipt_path IS NOT NULL/);
  });
});

describe('neither party can do the other half', () => {
  it('only the client uploads', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.submit_stage_payment_receipt('));
    expect(fn).toMatch(/IF NOT public\.is_project_client\([\s\S]{0,80}not_client/);
  });

  it('only the contractor or staff confirms', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.confirm_stage_payment('));
    expect(fn).toMatch(/NOT v_admin AND NOT public\.is_contractor_on\([\s\S]{0,120}not_contractor/);
  });

  it('a contractor cannot confirm a payment nobody claimed to make', () => {
    /**
     * Found by running the sequence rather than reading it. With `expected` accepted
     * for everyone, a contractor could confirm an unclaimed payment and open the next
     * stage alone — making the client's upload optional and skipping the step that
     * exists to put the client in control of progress.
     */
    const fn = sql.slice(sql.indexOf('FUNCTION public.confirm_stage_payment('));
    expect(fn).toMatch(/AND \(state = 'receipt_submitted' OR \(v_admin AND state = 'expected'\)\)/);
    expect(fn).toMatch(/no_receipt: the client has not uploaded a payment receipt/);
  });

  it('but staff still can, for the client who paid cash in person', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.confirm_stage_payment('));
    expect(fn).toMatch(/v_admin AND state = 'expected'/);
  });

  it('and the confirmation says which of the two it was', () => {
    // 'contractor_confirmed' and 'staff_confirmed' are different facts about who knows.
    expect(sql).toMatch(/funding_source IN \('provider', 'staff_confirmed', 'contractor_confirmed'\)/);
  });
});

describe('confirming is what opens the stage', () => {
  it('confirm_stage_payment opens it', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.confirm_stage_payment('));
    expect(fn).toMatch(/v_opened := public\.open_stage_if_settled\(p_stage\)/);
  });

  it('and keeps the stage column in step with the ledger', () => {
    // approve_stage reads payment_status, not the payments table. Two sources that
    // disagree is a stage you can neither approve nor explain.
    const fn = sql.slice(sql.indexOf('FUNCTION public.confirm_stage_payment('));
    expect(fn).toMatch(/UPDATE public\.project_stages SET payment_status = 'paid'/);
  });

  it('and approval tells the screen to ask for the receipt', () => {
    expect(sql).toMatch(/'awaiting_payment',\s*\(v_next\.id IS NOT NULL AND NOT public\.stage_funding_settled/);
  });
});

describe('the app can drive all three acts', () => {
  const lib = readFileSync('src/lib/supabase/verifications.ts', 'utf8');

  it('exposes the two new calls', () => {
    expect(lib).toMatch(/export async function submitStagePaymentReceipt/);
    expect(lib).toMatch(/export async function confirmStagePayment/);
  });

  it('and reads awaitingPayment back off the approval', () => {
    expect(lib).toMatch(/awaitingPayment: r\.awaiting_payment === true/);
  });
});
