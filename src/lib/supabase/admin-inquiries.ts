import { supabase } from './client';
import type { BuildType } from './inquiries';

/** Queue side of `contractor_inquiries` (migration 076). Admin-only, enforced by RLS. */

export type InquiryStatus = 'open' | 'introduced' | 'declined' | 'closed';

export interface ContractorInquiry {
  id: string;
  contractor_id: string;
  user_id: string | null;
  name: string;
  location: string;
  build_type: BuildType;
  message: string;
  status: InquiryStatus;
  admin_notes: string | null;
  created_at: string;
  /** Joined for display. The directory row may have been removed since. */
  contractor: { name: string; trade: string } | null;
}

export async function listInquiries(limit = 200): Promise<ContractorInquiry[]> {
  const { data, error } = await supabase
    .from('contractor_inquiries')
    .select('*, contractor:contractors(name, trade)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ContractorInquiry[];
}

/**
 * Move an inquiry through the queue.
 *
 * `name`, `location`, `build_type`, `message` and `contractor_id` cannot be changed here
 * or anywhere else — a BEFORE UPDATE trigger pins them. What the homeowner wrote is the
 * record of what they asked for; anything the team wants to add goes in `admin_notes`.
 */
export async function updateInquiry(
  id: string,
  patch: { status?: InquiryStatus; admin_notes?: string | null },
): Promise<void> {
  const { error } = await supabase.from('contractor_inquiries').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
