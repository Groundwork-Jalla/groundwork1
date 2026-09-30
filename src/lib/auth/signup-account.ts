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
 * A name. Deliberately nothing else: any role-shaped key here would be a value the
 * browser chose, and no trigger, policy or view may ever read one.
 */
export function signupMetadata(fullName: string): { full_name: string } {
  return { full_name: fullName };
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
