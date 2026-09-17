import type { TKey } from '@/lib/i18n';

// =========================================================
// Audit action → the sentence a person would say.
//
// One map, because the Overview's rail, the audit log and (Phase 5) the workspace's
// Activity tab must never describe the same row three ways. The database writes actions
// dotted (`verification.requested`, 086+); the dictionary cannot nest a key with a dot in
// it, so the key is the action with dots flattened — `admin.ops.action.verification_requested`.
//
// An action the dictionary does not know renders as `other` ("updated the project")
// rather than as the raw string, and `action-labels.test.ts` opens every migration and
// insists each action the database can write has a real label — so "other" is what an
// admin sees only for a row written by a future migration nobody has translated yet.
// =========================================================

/** The dictionary's flattened form of a database action. */
export function actionLabelKey(action: string): TKey {
  return `admin.ops.action.${action.replace(/\./g, '_')}` as TKey;
}

/**
 * Resolve an action to the label key that exists, falling back to `other`.
 * `t` is the dictionary lookup; a missing key returns itself, which is how the check works.
 */
export function actionLabel(action: string, t: (key: TKey) => string): string {
  const key = actionLabelKey(action);
  const hit = t(key);
  return hit === key ? t('admin.ops.action.other') : hit;
}

/**
 * Where a row's entity lives in the workspace, by entity type (05 §6 Activity: "entity
 * chip that deep-links"). Kept here so the Overview, the audit log and the Activity tab
 * agree; returns null for an entity with no tab of its own.
 */
export function entityTab(entityType: string | null | undefined):
  'stages' | 'financials' | 'conversations' | 'team' | null {
  switch (entityType) {
    case 'project_stage':
    case 'stage_verification':
    case 'site_update':       return 'stages';
    case 'payment':           return 'financials';
    case 'conversation':
    case 'decision':          return 'conversations';
    case 'contractor_invite':
    case 'project_verifier':  return 'team';
    // `support_ticket` (091 ticket.linked) has no workspace tab: tickets are Support's.
    default:                  return null;
  }
}
