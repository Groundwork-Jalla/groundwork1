import { supabase } from '@/lib/supabase/client';

// =========================================================
// The five numbers the partner funnel is measured by (136).
//
// Outreach → contractor signup → contractor onboarding → partner application →
// pre-qualification → the call with Philip → client introduction → activation.
//
// Every one of these used to be a question somebody answered by hand, which is why
// nobody could say where the drop-off was. The counting itself lives in
// `admin_partner_funnel` so that "onboarding completed" keeps meaning exactly what 116
// says it means, and not something this file decided separately.
// =========================================================

export interface PartnerFunnel {
  /** Contractor accounts created — the role, so project-invited contractors are excluded. */
  accounts: number;
  /** Contractor onboarding completed, as `contractor_onboarding_status` defines it (116). */
  onboarded: number;
  /** Said yes to the partner question at onboarding. The follow-up list sits in the gap
   *  between this and `applications`. */
  partnerInterested: number;
  /** Partner applications completed, in-app only (133). */
  applications: number;
  /** A live project they will introduce — the rule `isDecisionReady` applies. */
  prequalified: number;
  /**
   * Reached the booking step and were shown a slot.
   *
   * NOT confirmed bookings. Philip's calendar holds those and the widget is a
   * cross-origin iframe, so this is the nearest fact Groundwork owns. Label it as such
   * wherever it is shown — the gap between this and his calendar is itself the finding.
   */
  sentToBooking: number;
}

/** Is 136 on this database? Absent means hide the strip, not error — the same guard the
 *  rest of the admin surface uses. */
export async function partnerFunnelAvailable(): Promise<boolean> {
  const { error } = await supabase.rpc('admin_partner_funnel');
  if (!error) return true;
  if (error.code === 'PGRST202' || error.code === '42P01' || error.code === 'PGRST205') return false;
  return true;
}

export async function fetchPartnerFunnel(): Promise<PartnerFunnel> {
  const { data, error } = await supabase.rpc('admin_partner_funnel');
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    accounts:          n('accounts'),
    onboarded:         n('onboarded'),
    partnerInterested: n('partner_interested'),
    applications:      n('applications'),
    prequalified:      n('prequalified'),
    sentToBooking:     n('sent_to_booking'),
  };
}

/** One stage of the funnel, in the order the flow runs. */
export interface FunnelStage { key: keyof PartnerFunnel; count: number; dropFromPrevious: number }

/**
 * The funnel in order, with the drop at each step.
 *
 * `partnerInterested` is deliberately NOT a stage here: it is a branch, not a step —
 * somebody who said no to the partner question has not dropped out of anything, they are
 * a contractor using Groundwork, which is a legitimate outcome. Counting them as a loss
 * would make the funnel read as leakier than it is.
 */
export function funnelStages(f: PartnerFunnel): FunnelStage[] {
  const order: (keyof PartnerFunnel)[] =
    ['accounts', 'onboarded', 'applications', 'prequalified', 'sentToBooking'];
  return order.map((key, i) => {
    const count = f[key];
    const prev  = i === 0 ? count : f[order[i - 1]];
    return { key, count, dropFromPrevious: Math.max(0, prev - count) };
  });
}
