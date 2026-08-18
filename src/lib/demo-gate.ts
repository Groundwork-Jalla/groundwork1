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
 * Puts the contractor directory behind Jalla Verify.
 *
 * Started life as a blanket hide for the demo. It now checks the subscription instead,
 * because someone who upgrades from this very screen has to land back on a directory
 * they can actually see — a paywall that stays shut after payment is worse than no
 * paywall.
 *
 * Self Verify sees the upgrade prompt and no names; Jalla Verify and Jalla Management
 * see the directory. Tier comes from `profiles.subscription_tier`, which only the
 * Stripe webhook can write (migration 021) — not from user metadata, which the browser
 * can set.
 *
 * The list query is still skipped entirely while gated, so a locked-out visitor never
 * downloads a name.
 */
export const CONTRACTORS_LOCKED_FOR_DEMO = true;
