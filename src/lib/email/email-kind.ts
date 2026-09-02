/**
 * What kind of email a CRM note is recording.
 *
 * Lives here, not in `api/ghl/_email-log.ts`, because both sides need it: the browser
 * says what it is sending, and the serverless side turns that into the note's first
 * line. Nothing under `src/` may import from `api/` — those files read secrets — so a
 * shared vocabulary has to sit on this side of the line.
 *
 * No imports, no `import.meta`: this module is reachable from `api/`. See api/README.md.
 */
export type EmailKind =
  | 'contractor_application_received'
  | 'contractor_application_decision'
  | 'contractor_invite'
  | 'stage_update'
  | 'other';

/** The first line of the note in GHL. Keep these short — they are what a list shows. */
export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  contractor_application_received: 'Application acknowledgement',
  contractor_application_decision: 'Application decision',
  contractor_invite:               'Project invitation',
  stage_update:                    'Stage update',
  other:                           'Email',
};

/**
 * The kinds a *browser* caller may claim, for `/api/send-email`.
 *
 * That endpoint takes its recipient and body verbatim from the request, so the label is
 * caller-controlled too. Deliberately narrow: an admin's browser has no business
 * labelling something an application decision, which is sent by an endpoint that derives
 * everything from the database. Anything not on this list becomes `other` rather than
 * being rejected — a mislabelled note still beats a send that failed over a label.
 */
const CALLER_ASSIGNABLE: readonly EmailKind[] = ['stage_update', 'other'];

export type CallerEmailKind = 'stage_update' | 'other';

export function callerEmailKind(value: unknown): EmailKind {
  return typeof value === 'string' && (CALLER_ASSIGNABLE as readonly string[]).includes(value)
    ? (value as EmailKind)
    : 'other';
}
