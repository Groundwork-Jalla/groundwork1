// =========================================================
// Where the Overview goes.
//
// One table, because a KPI and its destination must never disagree. The rule (Favour,
// 14 Sep 2026): a KPI is not a navigation shortcut — it is a dataset. Clicking
// "Projects at risk — 3" has to arrive at exactly those three projects, not at all 22.
//
// TWO KINDS OF LINK, deliberately different:
//
//   KPI_LINKS      the metric's own filtered dataset.
//   SEE_ALL_LINKS  the whole module behind a five-row preview.
//
// NO DEAD PARAMETERS. A query string appears here only where the destination page
// actually reads it (`overview-links.test.ts` opens the route file and checks). Where a
// page's entire dataset already IS the metric — /admin/reviews is the pending_review
// queue, /admin/budgets is the unconfirmed-budget queue — the link carries no parameter,
// because a parameter that changes nothing is the same fiction as a fake number.
//
// `not_archived` is the projects module's name for the Overview's own definition of
// "total projects": every project whose status is not `archived`.
// =========================================================

export const KPI_LINKS = {
  /** All non-archived projects — the Overview's own count. */
  totalProjects:  '/admin/projects?status=not_archived',
  /** The page is the queue: it only ever loads stages in `pending_review`. */
  pendingReviews: '/admin/reviews',
  totalUsers:     '/admin/users',
  applications:   '/admin/applications?status=pending',
  quoteRequests:  '/admin/inquiries?status=open',
  /**
   * Needs reply — `conversations.status = 'waiting_on_us'`, 091's own state. The Inbox
   * reads `status` and shows exactly those, so the number and the page agree by
   * construction rather than by two definitions kept in step by hand.
   */
  conversations:  '/admin/inbox?status=waiting_on_us',
  /** `projectHealth(p).band === 'at_risk'` — the same call the Overview counted with. */
  atRisk:         '/admin/projects?health=at_risk',
  /** The page is the queue: Management projects with no `tracking_started_at`. */
  pendingBudgets: '/admin/budgets',
} as const;

export const SEE_ALL_LINKS = {
  activity:     '/admin/audit-log',
  attention:    '/admin/action-center',
  support:      '/admin/support',
  locations:    '/admin/projects?status=not_archived',
  funnel:       '/admin/applications',
  contractors:  '/admin/contractors',
  crm:          '/admin/crm',
  /** Inspections have no entity and therefore no module to see all of. */
  inspections:  null,
} as const;

export type KpiKey = keyof typeof KPI_LINKS;
