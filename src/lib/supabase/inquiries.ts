import { supabase } from './client';

/**
 * Contractor inquiries — the only way a homeowner reaches a contractor.
 *
 * Product rule, 9 Sep 2026: every form of contact happens inside Groundwork. Contractor
 * phone numbers and email addresses are not readable by any browser role (migration 075),
 * so this is not one option among several — it is the path.
 *
 * ── What was here before ─────────────────────────────────────────────────────────────
 * Nothing. The Request Quote dialog's entire submit handler was:
 *
 *   onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
 *
 * It showed a confirmation and sent no message anywhere — the same defect as the support
 * form, on the screen a paying subscriber uses to find a builder.
 *
 * ── The rule for callers ─────────────────────────────────────────────────────────────
 * This throws. A caller that catches must show a failure, never a confirmation.
 */

export type BuildType = 'residential' | 'commercial' | 'industrial' | 'mixed-use';

export interface NewInquiry {
  contractorId: string;
  /** Required. RLS enforces `user_id = auth.uid()` AND a Jalla Verify subscription. */
  userId: string;
  name: string;
  location: string;
  buildType: BuildType;
  message: string;
}

/**
 * File an inquiry. Throws if it does not land.
 *
 * The insert is the whole client responsibility: the admin email and the notification
 * bell fire from a trigger on the table, so a new caller cannot forget them.
 */
export async function createContractorInquiry(i: NewInquiry): Promise<void> {
  const { error } = await supabase.from('contractor_inquiries').insert({
    contractor_id: i.contractorId,
    user_id:       i.userId,
    name:          i.name,
    location:      i.location,
    build_type:    i.buildType,
    message:       i.message,
  });

  if (error) {
    console.error('[inquiry] insert failed:', error);
    throw new Error(error.message);
  }
}
