/**
 * The phone rules live in `src/lib/phone.ts` so the browser and the server share one
 * implementation: the profile form normalises what a client types, and this side
 * normalises what reaches GoHighLevel. Two copies would drift, and the number stored
 * would stop matching the number sent.
 *
 * Kept as a re-export rather than moving every caller: the server modules here import
 * `./_phone.js`, and the path is the only thing that changed.
 */
export { normalisePhone, isE164 } from '../../src/lib/phone.js';
