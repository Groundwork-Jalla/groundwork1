/**
 * The Skool community the waitlist success screen and the welcome email both point at.
 *
 * Shared because the two must never drift: someone who closes the tab before clicking
 * gets the same link by email, and a stale copy in one place would send them nowhere.
 * Plain constant, no `import.meta` — this module is pulled into the serverless email
 * path, where that would be a parse error (see lib/i18n/translate.ts).
 */
export const SKOOL_URL = 'https://www.skool.com/jalla-community-1888/about';
