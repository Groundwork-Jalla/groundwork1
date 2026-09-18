// =========================================================
// The closed option lists on the contractor application.
//
// These keys are what the row stores; the labels live in the dictionary under
// `contractorApply.form.<group>.<key>` and are resolved by whoever renders them (the
// public form, the admin editor, the CRM payload, the application email). One list per
// group, here, so the admin editing an application offers exactly the choices the
// applicant had — a key that exists in one place and not the other would render as its
// raw value everywhere else.
//
// Roles are in application-types.ts because the email templates need them from api/.
// =========================================================

export const YEARS_KEYS        = ['under1', 'y1_3', 'y3_5', 'y5_10', 'y10'] as const;
export const OPERATES_KEYS     = ['registered', 'independent', 'small_team', 'larger_firm'] as const;
export const PROJECT_TYPE_KEYS = ['residential', 'multi_family', 'commercial', 'renovations', 'land', 'legal', 'infrastructure', 'other'] as const;
export const CONCURRENT_KEYS   = ['one', 'two_three', 'four_five', 'five_plus'] as const;
