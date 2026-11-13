/** Product activation has one sender. GHL still owns acquisition/sales workflows. */
const ACTIVATION_EVENTS = new Set([
  'user_signup','project_created','contractor_onboarding_completed','client_invited','contractor_invited',
  'invitation_accepted','project_membership_active','contractor_support_requested','no_active_project_selected',
]);
export function groundworkOwnsCommunication(event: string): boolean { return ACTIVATION_EVENTS.has(event); }
