import { supabase } from '@/lib/supabase/client';

// =========================================================
// "We could not find out" is not "no".
//
// Favour, 9 Nov 2026: "some contractors that signed up as contractors somehow,
// somewhere, end up in client's dashboard... I don't know at what point or what they
// click that does that."
//
// There is no click. Every reader below used to collapse an ERROR into `false`:
//
//     return !error && (data?.length ?? 0) > 0;
//
// AuthContext then set `rolesChecked = true` either way, and `work/_layout.tsx` acts
// on that with `navigate('/dashboard', { replace: true })`. So one failed read — a
// dropped mobile connection, a token refreshing mid-flight, a Supabase hiccup — turns
// a contractor into a client on whatever page they were looking at, and `replace`
// means Back does not undo it. It happens silently, at no particular moment, which is
// exactly how it was described.
//
// The old comment argued the opposite and is worth answering directly: "a verifier who
// is briefly routed to the client dashboard can navigate to /verifiers themselves."
// That assumes they know they were demoted. They do not — they see a client dashboard
// and conclude that is their account.
//
// So the readers below report whether they got an answer at all. The boolean wrappers
// stay for callers that genuinely want "treat unknown as no" (a one-off landing
// decision the person can navigate away from); anything that GATES a surface must use
// the `read*` form and do nothing until it has a real answer.
// =========================================================

/** An answer, or an admission that there isn't one. */
export type RoleRead =
  | { ok: true; held: boolean }
  | { ok: false; error: string };

/**
 * Does this account hold the `verifier` role?
 *
 * Read from `user_roles`, which a user may read for themselves (001) — the same
 * canonical table `is_admin()` uses, rather than JWT metadata, so granting the role is
 * one insert and takes effect on the next sign-in with no token surgery.
 *
 * Reports whether it got an answer. A read that fails is `ok: false`, NOT "no role" —
 * see the header for why that distinction is the whole bug.
 */
export async function readVerifierRole(userId: string | null | undefined): Promise<RoleRead> {
  // No user is a real answer: a signed-out visitor holds no role.
  if (!userId) return { ok: true, held: false };
  try {
    const { data, error } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'verifier').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, held: (data?.length ?? 0) > 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}

/** Unknown treated as no. Only for a landing decision the person can navigate away from. */
export async function holdsVerifierRole(userId: string | null | undefined): Promise<boolean> {
  const r = await readVerifierRole(userId);
  return r.ok && r.held;
}

/**
 * A contractor role opens /work before the first assignment. Existing contractors
 * with accepted assignments retain access even without an explicit role grant.
 * Project RLS continues to require membership; client metadata never grants access.
 */
export async function readContractorAccess(userId: string | null | undefined): Promise<RoleRead> {
  if (!userId) return { ok: true, held: false };
  let explicitNonContractor = false;
  const [role, assignment] = await Promise.all([
    (async (): Promise<RoleRead> => {
      try {
        const { data, error } = await supabase
          .from('user_roles').select('role').eq('user_id', userId).limit(10);
        if (error) return { ok: false, error: error.message };
        const held = (data ?? []).some(row => row.role === 'contractor');
        explicitNonContractor = !held && (data?.length ?? 0) > 0;
        return { ok: true, held };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
      }
    })(),
    readContractorAssignment(userId),
  ]);

  // An explicit correction controls the dashboard. Legacy accounts without a role
  // can still use an accepted assignment as their contractor account fallback.
  if (role.ok && explicitNonContractor) return { ok: true, held: false };
  if (role.ok && role.held) return { ok: true, held: true };
  if (assignment.ok && assignment.held) return { ok: true, held: true };
  // Otherwise both have to have answered before "no" can be believed.
  if (!role.ok) return role;
  if (!assignment.ok) return assignment;
  return { ok: true, held: false };
}

export async function readContractorAssignment(userId: string | null | undefined): Promise<RoleRead> {
  if (!userId) return { ok: true, held: false };
  try {
    const { data, error } = await supabase
      .from('contractor_invites')
      .select('project_id')
      .eq('contractor_user_id', userId)
      .eq('status', 'accepted')
      .limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, held: (data?.length ?? 0) > 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}

/** Unknown treated as no. Only for a landing decision the person can navigate away from. */
export async function holdsContractorAccess(userId: string | null | undefined): Promise<boolean> {
  const r = await readContractorAccess(userId);
  return r.ok && r.held;
}

export async function holdsContractorAssignment(userId: string | null | undefined): Promise<boolean> {
  const r = await readContractorAssignment(userId);
  return r.ok && r.held;
}
