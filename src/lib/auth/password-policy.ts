// =========================================================
// One password policy, for every place a password is set.
//
// There were two, and they disagreed. `/auth/signup` required 8 characters with an
// uppercase and a digit; `/auth/new-password` — the page you land on from a reset email
// — required only `length >= 8`. So the reset flow was a complete bypass of the rules
// the signup form advertises: set a compliant password, reset it, choose "aaaaaaaa".
//
// Anything that sets a password imports from here. The rules are data, the evaluation is
// pure, and neither knows about React or i18n — the UI maps `rule.id` to a dictionary
// key, so a rule can be added without touching a component.
//
// WHY THESE RULES. Length and a blocklist do far more work than symbol mandates, which
// mostly produce "Password1!" — so the required set is length + three character classes,
// and the symbol contributes to the STRENGTH SCORE without being mandatory. What is
// mandatory beyond that is not composition at all: a password may not contain the user's
// own name or email, and may not be one of the passwords everybody tries first. Those
// two catch the passwords that actually get guessed.
//
// SERVER SIDE. This is a client policy and cannot be the only one. Supabase enforces its
// own minimum in Dashboard > Authentication > Policies; set it to at least
// MIN_LENGTH there so a direct API call cannot do better than this form allows.
// =========================================================

/** Raised from 8. Length is the single most useful requirement, so it carries the weight. */
export const MIN_LENGTH = 10;

/** Beyond this, more length stops adding to the score. */
const LONG_LENGTH = 16;

export type RuleId = 'length' | 'upper' | 'lower' | 'number' | 'notCommon' | 'notPersonal';

export interface PasswordContext {
  /** Used to reject a password containing the local part of the address. */
  email?: string | null;
  /** Used to reject a password containing a name word. */
  fullName?: string | null;
}

export interface RuleResult {
  id: RuleId;
  passed: boolean;
}

export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  rules: RuleResult[];
  /** Every required rule passed — this is what gates submission. */
  valid: boolean;
  /** 0–4, for the meter. Independent of `valid`: a long passphrase can score well before
   *  it has a digit, and a barely-compliant password can be valid but score 1. */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
}

/**
 * The passwords tried first, normalised to lowercase.
 *
 * Deliberately short. A real breach corpus is millions of entries and belongs behind an
 * API (k-anonymity range query) rather than in a bundle every visitor downloads — this is
 * the head of the distribution, which is where the guesses actually land. Compared after
 * stripping digits and symbols from the end, so `Password123!` is caught by `password`.
 */
const COMMON = new Set([
  'password', 'passwort', 'motdepasse', 'password1', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  'qwerty', 'qwertyuiop', 'azerty', 'azertyuiop', 'asdfgh', 'zxcvbn',
  'letmein', 'welcome', 'admin', 'administrator', 'root', 'login', 'guest',
  'iloveyou', 'sunshine', 'princess', 'monkey', 'dragon', 'football', 'baseball',
  'abc', 'abcd', 'abcabc', 'aaaa', 'test', 'testing', 'changeme', 'secret',
  'trustno', 'freedom', 'whatever', 'starwars', 'superman', 'batman',
  // The ones this product invites by name.
  'groundwork', 'jalla', 'tryjalla', 'construction', 'builder', 'chantier', 'cameroun',
]);

/** Trailing digits and punctuation carry almost no entropy — `password2026!` is `password`. */
function commonStem(pw: string): string {
  return pw.toLowerCase().replace(/[^a-z]+$/i, '').replace(/^[^a-z]+/i, '');
}

/**
 * Is the whole password one short unit repeated?
 *
 * `passwordpassword` is not in the list and does not stem to anything in it, but it is
 * exactly as guessable as `password` — repetition adds length without adding a single bit
 * worth having. Caught by rebuilding the password from each candidate unit rather than by
 * listing the repetitions, which would be endless.
 */
function isRepeatedCommon(pw: string): boolean {
  const lower = pw.toLowerCase();
  for (let unit = 2; unit <= lower.length / 2; unit++) {
    if (lower.length % unit !== 0) continue;
    const head = lower.slice(0, unit);
    if (head.repeat(lower.length / unit) !== lower) continue;
    if (COMMON.has(head) || COMMON.has(commonStem(head))) return true;
  }
  return false;
}

function isCommon(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return true;

  const stem = commonStem(pw);
  if (stem.length >= 3 && COMMON.has(stem)) return true;

  if (isRepeatedCommon(pw)) return true;

  // A single repeated character, whatever it is: 'aaaaaaaaaa' passes a naive length check.
  if (/^(.)\1+$/.test(pw)) return true;

  // A straight run off the keyboard or the number line.
  return /^(?:0123456789|1234567890|123456789|12345678|1234567|123456)\d*$/.test(pw);
}

/**
 * Words from the person's own identity that must not appear in the password.
 *
 * Short fragments are dropped: a two-letter name part would reject half of everything,
 * and the point is to catch "favour1234", not any password containing "de".
 */
function personalTokens(ctx: PasswordContext): string[] {
  const tokens: string[] = [];

  const local = (ctx.email ?? '').split('@')[0] ?? '';
  for (const part of local.split(/[^a-zA-Z0-9]+/)) {
    if (part.length >= 4) tokens.push(part.toLowerCase());
  }
  for (const part of (ctx.fullName ?? '').split(/[^a-zA-Z0-9]+/)) {
    if (part.length >= 4) tokens.push(part.toLowerCase());
  }
  return tokens;
}

function containsPersonal(pw: string, ctx: PasswordContext): boolean {
  const lower = pw.toLowerCase();
  return personalTokens(ctx).some(tok => lower.includes(tok));
}

const hasUpper  = (pw: string) => /[A-Z]/.test(pw);
const hasLower  = (pw: string) => /[a-z]/.test(pw);
const hasNumber = (pw: string) => /[0-9]/.test(pw);
const hasSymbol = (pw: string) => /[^A-Za-z0-9]/.test(pw);

/**
 * Score the password for the meter, 0–4.
 *
 * Not an entropy estimate and not presented as one — it is an ordering, so that a longer
 * or more varied password visibly moves the bar. The blocklist failures floor it at 0
 * however long the password is, because a scored 4 next to "this password is on every
 * list" would be the screen contradicting itself.
 */
function scoreOf(pw: string, ctx: PasswordContext): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  if (isCommon(pw) || containsPersonal(pw, ctx)) return 0;

  let points = 0;

  if (pw.length >= MIN_LENGTH)  points += 2;
  else if (pw.length >= 8)      points += 1;
  if (pw.length >= 13)          points += 1;
  if (pw.length >= LONG_LENGTH) points += 1;

  const classes = [hasUpper(pw), hasLower(pw), hasNumber(pw), hasSymbol(pw)].filter(Boolean).length;
  points += classes;

  // Distinct characters, not length, is what separates a passphrase from 'abababababab'.
  if (new Set(pw).size >= 8) points += 1;

  if (points <= 3) return 1;
  if (points <= 5) return 2;
  if (points <= 7) return 3;
  return 4;
}

const LABELS: Record<number, StrengthLabel> = {
  0: 'weak', 1: 'weak', 2: 'fair', 3: 'good', 4: 'strong',
};

/**
 * Evaluate a password against the policy.
 *
 * `ctx` is optional so a caller with no profile to hand still gets the composition rules
 * — the personal-information rule simply passes when there is nothing to compare against,
 * which is the honest answer rather than a false negative.
 */
export function evaluatePassword(pw: string, ctx: PasswordContext = {}): PasswordAssessment {
  const rules: RuleResult[] = [
    { id: 'length',      passed: pw.length >= MIN_LENGTH },
    { id: 'upper',       passed: hasUpper(pw) },
    { id: 'lower',       passed: hasLower(pw) },
    { id: 'number',      passed: hasNumber(pw) },
    { id: 'notCommon',   passed: pw.length > 0 && !isCommon(pw) },
    { id: 'notPersonal', passed: pw.length > 0 && !containsPersonal(pw, ctx) },
  ];

  const score = scoreOf(pw, ctx);

  return {
    rules,
    valid: rules.every(r => r.passed),
    score,
    label: LABELS[score],
  };
}

/** Convenience for the submit handlers, which only care whether to stop. */
export function isPasswordAcceptable(pw: string, ctx: PasswordContext = {}): boolean {
  return evaluatePassword(pw, ctx).valid;
}

/** The first unmet rule, so an error message can name one thing rather than six. */
export function firstFailure(pw: string, ctx: PasswordContext = {}): RuleId | null {
  return evaluatePassword(pw, ctx).rules.find(r => !r.passed)?.id ?? null;
}
