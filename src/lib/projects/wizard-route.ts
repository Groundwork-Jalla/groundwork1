// =========================================================
// Which steps a wizard run actually visits, and how it moves between them.
//
// Pure, and in its own file, because the bug it exists to prevent is arithmetic
// rather than React. A build with a plan and a bill of quantities skips steps 4 to 7
// — the documents answer those questions — so it visits five screens: 1, 2, 3, 8, 9.
//
// FIVE SCREENS WHOSE LAST ONE IS STEP NINE. The count and the final index are
// different numbers, and the provider used to keep only the count. `next()` clamped
// `prev + 1` to it, so Continue on step 8 moved to step 5; the provider's skip effect
// saw a step it was meant to skip and sent it back to 8; the screen reappeared from
// the top. A contractor on a call on 28 October ticked the budget confirmation,
// pressed the button, and went round that loop every time he tried. Step 9 is the one
// that creates the project, so nothing he could have done would have worked.
//
// Movement therefore WALKS THE ROUTE rather than counting. There is no arithmetic on
// step numbers here at all, which is the point.
// =========================================================

/**
 * The steps the document route visits, in order. Its last entry is the real last step.
 *
 * THREE screens: where you are building, the summary, the confirmation. Steps 2 and 3
 * — what are you building, and what type — are gone from this route entirely, because
 * somebody who hands over a floor plan and a bill has already answered them in more
 * detail than a dropdown holds. `document-identity` reads the answers out of the
 * documents instead; see the note there about why that is not optional.
 */
export const DOCUMENT_ROUTE = [1, 8, 9] as const;

/** The steps this run visits, in order. */
export function stepRoute(documentFlow: boolean, totalSteps: number): readonly number[] {
  return documentFlow
    ? DOCUMENT_ROUTE
    : Array.from({ length: totalSteps }, (_, i) => i + 1);
}

/**
 * The step after this one, or this one if it is the last.
 *
 * A step that is not ON the route is a draft saved before the plan question existed,
 * or one whose answer changed underneath it. Those move to the next step the route
 * does contain, rather than being stranded.
 */
export function nextStep(route: readonly number[], current: number): number {
  const last = route[route.length - 1] ?? current;
  const here = route.indexOf(current);
  if (here === -1) return route.find(step => step > current) ?? last;
  return route[Math.min(here + 1, route.length - 1)] ?? last;
}

/** The step before this one, or this one if it is the first. */
export function prevStep(route: readonly number[], current: number): number {
  const first = route[0] ?? current;
  const here = route.indexOf(current);
  if (here === -1) {
    for (let i = route.length - 1; i >= 0; i--) {
      const step = route[i];
      if (step != null && step < current) return step;
    }
    return first;
  }
  return route[Math.max(here - 1, 0)] ?? first;
}

/**
 * Put a requested step onto the route.
 *
 * Never a clamp to a COUNT: that is what turned the plan question's own `goTo(8)`
 * into step 5 on the five-screen route.
 */
export function clampToRoute(route: readonly number[], requested: number): number {
  const last = route[route.length - 1];
  const first = route[0];
  if (last == null || first == null) return requested;
  if (route.includes(requested)) return requested;
  if (requested <= first) return first;
  return route.find(step => step >= requested) ?? last;
}
