import type { HealthBand } from './health';

// =========================================================
// The projects module's filters, as one pure definition.
//
// This exists so the Overview and /admin/projects cannot drift into two meanings of the
// same word. "At risk" is `projectHealth(project).band === 'at_risk'` in both places —
// the Overview counts it, this filters by it, and neither owns a second copy of the rule.
//
// `not_archived` is a filter, not a status: the Overview's "Total projects" excludes
// archived projects, so its link has to name that condition rather than silently land on
// a longer list than the number it was clicked from.
// =========================================================

export const PROJECT_STATUS_FILTERS = ['not_archived', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatusFilter = typeof PROJECT_STATUS_FILTERS[number];

export const PROJECT_HEALTH_FILTERS: readonly HealthBand[] =
  ['at_risk', 'attention', 'on_track', 'planning', 'done', 'archived'] as const;

/** Null for absent or unrecognised — an unknown value filters nothing rather than everything. */
export function parseStatusFilter(value: string | null | undefined): ProjectStatusFilter | null {
  return PROJECT_STATUS_FILTERS.includes(value as ProjectStatusFilter) ? (value as ProjectStatusFilter) : null;
}

export function parseHealthFilter(value: string | null | undefined): HealthBand | null {
  return PROJECT_HEALTH_FILTERS.includes(value as HealthBand) ? (value as HealthBand) : null;
}

export function matchesStatusFilter(status: string, filter: ProjectStatusFilter): boolean {
  return filter === 'not_archived' ? status !== 'archived' : status === filter;
}
