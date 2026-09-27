// =========================================================
// Who may see the contractor directory.
//
// This began life in August 2026 as a temporary flag that hid the directory for a
// demo, and it kept that name long after it stopped doing that. It is now the
// product's paywall: a permanent rule about what a plan includes, not a switch
// waiting to be removed.
//
//   grep -rn "CONTRACTOR_DIRECTORY_REQUIRES_PLAN" src/
// =========================================================

/**
 * Puts the contractor directory behind Jalla Verify.
 *
 * It checks the subscription rather than hiding the page outright, because someone who
 * upgrades from this very screen has to land back on a directory they can actually see
 * — a paywall that stays shut after payment is worse than no paywall.
 *
 * Self Verify sees the upgrade prompt and no names; Jalla Verify and Jalla Management
 * see the directory. Tier comes from `profiles.subscription_tier`, which only the
 * Stripe webhook can write (migration 021) — not from user metadata, which the browser
 * can set.
 *
 * The list query is skipped entirely while gated, so a visitor without the plan never
 * downloads a name.
 *
 * Setting this false opens the directory to every signed-in user. That is a pricing
 * decision, not a debugging convenience.
 */
export const CONTRACTOR_DIRECTORY_REQUIRES_PLAN = true;
