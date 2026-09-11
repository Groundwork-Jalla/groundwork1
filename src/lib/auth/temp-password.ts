// `.js` because api/_handlers imports this and Node's ESM resolver needs the extension.
import { isPasswordAcceptable, type PasswordContext } from './password-policy.js';

// =========================================================
// Temporary passwords for admin-provisioned accounts.
//
// An admin creates a Jalla Management client's account and reads the password out to
// them, or writes it down. So it has to be:
//
//   · unguessable — it is a real credential until the client replaces it;
//   · transcribable — no 0/O, 1/l/I, or characters that need explaining over the phone;
//   · acceptable to our own password policy, or the very first thing the client would
//     see is a rule the admin's password broke.
//
// Groups of four separated by dashes, because "Kf7m-Rq2x-Wn9p-Ht4z" survives being read
// aloud and "Kf7mRq2xWn9pHt4z" does not. Each group is drawn to contain the three
// character classes the policy requires, so the result never has to be regenerated.
// =========================================================

/** No 0/O, 1/l/I, 5/S, 2/Z, 8/B — the pairs that get mistranscribed. */
const UPPER = 'ACDEFGHJKMNPQRTUVWXY';
const LOWER = 'acdefghjkmnpqrtuvwxy';
const DIGIT = '34679';

const GROUPS = 4;
const GROUP_LEN = 4;

/** Uniform pick with rejection sampling — no modulo bias. */
function pick(alphabet: string, random: (max: number) => number): string {
  return alphabet[random(alphabet.length)];
}

/**
 * `random(max)` returns an integer in [0, max). Injected so the caller decides the
 * source: node:crypto's randomInt on the server, and a deterministic one in tests.
 */
export function generateTemporaryPassword(
  random: (max: number) => number = defaultRandom,
  ctx: PasswordContext = {},
): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const groups: string[] = [];
    for (let g = 0; g < GROUPS; g++) {
      // One of each class per group, then fill; shuffle so the classes are not positional.
      const chars = [pick(UPPER, random), pick(LOWER, random), pick(DIGIT, random)];
      while (chars.length < GROUP_LEN) chars.push(pick(UPPER + LOWER + DIGIT, random));
      for (let i = chars.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      groups.push(chars.join(''));
    }
    const candidate = groups.join('-');
    // The policy also refuses passwords containing the person's name or email; a random
    // string can hit that by chance, so check and redraw rather than hand out a reject.
    if (isPasswordAcceptable(candidate, ctx)) return candidate;
  }
  throw new Error('could not generate an acceptable temporary password');
}

function defaultRandom(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let v: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}
