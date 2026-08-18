// =========================================================
// TEMPORARY — demo gate. Remove after the demo (asked for 19 Aug 2026, ~2 days).
//
// Set false, or delete this file and the three references to it, to restore normal
// behaviour. Nothing else needs unwinding: the contractor page's real tier logic is
// untouched underneath, this only short-circuits in front of it.
//
// WHY A FLAG AND NOT AN EDIT: reverting a scattered edit two days later means
// remembering what was scattered. One constant, three call sites, one grep.
//
//   grep -rn "CONTRACTORS_LOCKED_FOR_DEMO" src/
// =========================================================

/**
 * Hides the contractor directory behind an upgrade prompt for everyone, regardless of
 * tier — the ask was that no contractor names are shown at all during the demo, not
 * that the existing plan gate be tightened.
 *
 * The list query is skipped entirely while this is on, so the names never reach the
 * browser. Gating in the render alone would leave them in the network tab.
 */
export const CONTRACTORS_LOCKED_FOR_DEMO = true;
