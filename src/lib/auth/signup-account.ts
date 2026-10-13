// =========================================================
// What kind of account the signup page is creating.
//
// This decides WORDING, never privilege. An earlier draft put
// `{ account_type: 'contractor', role: 'contractor' }` into the signup metadata and had a
// trigger on `auth.users` read it back — but `options.data` in signUp() is set by the
// browser, so that let anyone grant themselves the contractor role.
//
// The rule now (100): contractor standing is earned by an application an admin accepted,
// and claimed with a token we emailed. Nothing a visitor types can confer it.
// =========================================================

export type SignupAccountType = 'homeowner' | 'contractor';

/**
 * Which copy the page shows.
 *
 * `?invite=` means a client has invited them to a project, so the page addresses a
 * contractor — their standing still comes from accepting that invite, not from here.
 * `?role=contractor` is the radio, which leads to the application form rather than an
 * account (see CONTRACTOR_APPLY_PATH).
 */
export function signupAccountType(params: URLSearchParams): SignupAccountType {
  return params.get('invite') || params.get('role') === 'contractor'
    ? 'contractor' : 'homeowner';
}

/**
 * Everything stored on the new account.
 *
 * A name, and a phone number when one was given. Deliberately nothing else: any
 * role-shaped key here would be a value the browser chose, and no trigger, policy or view
 * may ever read one.
 *
 * ── Why a phone number is not the same risk ──────────────────────────────────────────
 * The warning above is about PRIVILEGE. A phone number confers none: the worst a liar
 * achieves is their own profile carrying somebody else's number, which is exactly what
 * `/profile` has always allowed any signed-in person to do. It is a contact detail the
 * account holder asserts about themselves, and `handle_new_user` (102) stores it only when
 * it is already E.164 — an unusable number is dropped rather than kept as one that looks
 * reachable.
 *
 * Normalisation happens at the call site, with `normalisePhone` and the country in hand.
 * This function does not clean up its input; it passes on what it was given or omits it.
 */
export function signupMetadata(
  fullName: string,
  phone?: string | null,
  /**
   * Which door they signed up at — NOT a role, and never read as one.
   *
   * ── Why this is allowed when the warning above forbids a role ────────────────────────
   * The warning is about PRIVILEGE, and it still stands: nothing may read a browser-set
   * key and turn it into standing the person has not earned. This key does not do that.
   *
   * Since 106 and 108, `register_contractor_account()` and `register_verifier_account()`
   * are callable by ANY signed-in user. So "I signed up as a contractor" confers nothing
   * the person could not already confer on themselves by calling that RPC from the
   * console. It is a preference, and the callback maps it through a fixed list of exactly
   * those two open RPCs — never into `user_roles`, and never near `admin`.
   *
   * ── Why it has to live here rather than in localStorage ──────────────────────────────
   * Sign-up ends on "check your email" and the session is established by /auth/callback
   * in whatever browser opens that mail. A marker parked in localStorage is simply absent
   * when somebody signs up on a laptop and opens the mail on their phone — and the
   * fall-through lands them in CLIENT onboarding, holding no role, looking like the
   * product signed them up as the wrong thing. This rides on the account, so it survives
   * the hop.
   */
  intent?: SignupIntent | null,
): { full_name: string; phone?: string; signup_intent?: SignupIntent } {
  const p = (phone ?? '').trim();
  return {
    full_name: fullName,
    ...(p ? { phone: p } : {}),
    ...(intent ? { signup_intent: intent } : {}),
  };
}

/**
 * The doors whose role a person may grant themselves (106, 108).
 *
 * Deliberately NOT a general role type. Adding a value here only does anything if a
 * matching open RPC exists, and the callback's map is what decides that — so a new entry
 * cannot become a privilege by itself.
 */
export type SignupIntent = 'contractor' | 'verifier';

const SIGNUP_INTENTS: readonly SignupIntent[] = ['contractor', 'verifier'] as const;

/** Narrow whatever came back from `user_metadata`, which is browser-written. */
export function signupIntentOf(v: unknown): SignupIntent | null {
  return typeof v === 'string' && (SIGNUP_INTENTS as readonly string[]).includes(v)
    ? (v as SignupIntent)
    : null;
}

/**
 * Where someone choosing "contractor" actually goes.
 *
 * Not to an account. Groundwork reviews contractors before they can hold one, so the
 * honest next step is the application — and offering a signup form that produces an
 * account with no standing would be a worse lie than sending them here.
 */
export const CONTRACTOR_APPLY_PATH = '/contractor-apply';

/**
 * Does this choice lead somewhere other than the signup form?
 *
 * True only for the radio. Someone arriving on an invite link is signing up for a real
 * account right now — they have a project waiting — so the form stays.
 */
export function signupGoesToApplication(params: URLSearchParams): boolean {
  return !params.get('invite') && params.get('role') === 'contractor';
}
