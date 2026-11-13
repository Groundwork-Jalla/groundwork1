import { supabase } from '@/lib/supabase/client';

// =========================================================
// Activation milestones → Groundwork communication (Communication Flow v1.0, §9.1).
//
// The later product decision put welcome/reminder delivery, replies and human
// follow-up inside Groundwork Admin, with Resend transporting email. The legacy
// endpoint name remains compatible; its server-side event validation feeds the
// Groundwork engine and durable milestone tracking before any optional CRM mirror.
//
// ── Why this is separate from trackFunnel ──────────────────────────────────────────
//
// They look alike and answer opposite questions. `trackFunnel` writes to our own
// `funnel_events` so the admin dashboard can report how many people got stuck; this
// tells an outside system to start or stop emailing a person. One is measurement, the
// other is an action with a consequence somebody receives in their inbox — so a
// milestone that is both gets both calls, deliberately, rather than one call doing
// double duty and a reporting change silently altering who is emailed.
//
// ── Never trusted on arrival ───────────────────────────────────────────────────────
//
// The event name and at most a project id are sent. The endpoint re-derives the person,
// their role, their language and whether the claim is even true before it forwards
// anything. See api/_handlers/crm-lifecycle.ts.
// =========================================================

/** The milestones a signed-in person can report about themselves. */
export type LifecycleEvent =
  | 'contractor_onboarding_completed'
  | 'invitation_accepted'
  | 'project_membership_active'
  | 'contractor_support_requested'
  | 'no_active_project_selected';

/**
 * Tell the CRM a milestone was reached. Never throws, never blocks.
 *
 * Same rule as the funnel: the communication is worth less than the action. If this
 * fails the contractor has still finished onboarding and the client has still joined
 * the build — they just do not get the next email, which is recoverable, where a
 * screen that hung on a CRM call would not be.
 */
export async function recordLifecycle(
  event: LifecycleEvent,
  projectId?: string | null,
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch('/api/events?action=crm-lifecycle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event, projectId: projectId ?? null }),
    });
  } catch {
    // Offline, signed out, CRM unconfigured. All are "no email", not "stop".
  }
}

/** Fire and forget, for call sites that must not wait on a CRM. */
export function trackLifecycle(event: LifecycleEvent, projectId?: string | null): void {
  void recordLifecycle(event, projectId);
}
