import { useAuth } from '@/contexts/AuthContext';
import { TourGuide } from './TourGuide';

// =========================================================
// Which of the two introductions this person gets.
//
// A contractor's first job is a client; a client's first job is their own build. They
// are genuinely different openings, so they are genuinely different tours — see
// `lib/tour/steps.ts`.
//
// ── Why it waits for `rolesChecked` ─────────────────────────────────────────────────
// `isContractor` starts false and becomes true once the role read answers. Rendering on
// that first value would open a contractor's session by showing them the client tour,
// and the first step is written in a client's words about their own build. One wrong
// sentence at the very start of somebody's first session is exactly the thing an
// orientation is supposed to prevent.
//
// This is the same distinction that caused the demotion bug: "we have not found out" is
// not "no". Here it costs a few hundred milliseconds of nothing, which is the right
// price.
// =========================================================

export function RoleTour() {
  const { isContractor, rolesChecked } = useAuth();
  if (!rolesChecked) return null;
  return <TourGuide tour={isContractor ? 'contractor-setup' : 'client-setup'} />;
}
