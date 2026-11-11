import type { GroundworkUse, ProjectStatus } from './partner-qualification';

// =========================================================
// Resuming the partner application where it was left.
//
// Favour, 11 Nov 2026: "when filling the partner form, once you leave the page to go
// elsewhere, even if you were at the end, it takes you back to square one."
//
// The answers were already being SAVED — every two seconds, to `contractor_application_
// drafts`, so /admin/drafts can chase whoever stopped halfway (043 for the public form,
// then the partner form). They were never READ BACK: the page opened on an empty form,
// which to the person is indistinguishable from the answers being lost. And the page
// they had reached was not saved at all, so even a restore would have put them on
// question one with twelve answers filled in behind it.
//
// So the saved draft is now the thing to resume from, and it carries the page as well
// as the answers. One source, and it survives a change of device, which a browser-only
// copy would not: start on a phone, finish on a laptop.
//
// ── Validated, never trusted ────────────────────────────────────────────────────────
// What comes back is JSON that a browser wrote; it is treated like any other input. A
// closed-set answer is kept only if it is one of its set, a text answer only if it is
// text of sane length, a page only if it is a page. Anything else becomes "unanswered",
// which is the state the form already knows how to show.
// =========================================================

export interface PartnerDraftRestore {
  callLang: string;
  years: string;
  operatesAs: string;
  capacity: string;
  regions: string;
  history: string;
  whyJoin: string;
  differentiator: string;
  projectStatus: ProjectStatus | null;
  projectStage: string;
  startWindow: string;
  clientOnSiteDaily: boolean | null;
  offsiteReason: string;
  offsiteOther: string;
  useGroundwork: GroundworkUse | null;
  /** Where they were. 0 is the first page. */
  page: number;
  pageStack: number[];
}

const PROJECT_STATUS: ProjectStatus[] = ['running', 'starting', 'none'];
const GROUNDWORK_USE: GroundworkUse[] = ['yes', 'maybe', 'no'];
/** More pages than the form has, and ever will. Guards a stored number, not the UI. */
const MAX_PAGE = 20;

const str = (v: unknown, max = 4000): string => (typeof v === 'string' && v.length <= max ? v : '');
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const page = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_PAGE ? v : null;

/**
 * The saved draft as form state, or null when there is nothing worth resuming.
 *
 * "Nothing worth resuming" is a payload with no answer in it at all — the form starts
 * fresh, which is what it would have shown anyway.
 */
export function restorePartnerDraft(payload: unknown): PartnerDraftRestore | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;

  const languages = Array.isArray(p.languages) ? p.languages.filter(l => typeof l === 'string') : [];
  const restored: PartnerDraftRestore = {
    callLang: str(languages[0], 20),
    years: str(p.years, 40),
    operatesAs: str(p.operatesAs, 80),
    capacity: str(p.capacity, 40),
    regions: str(p.regions, 500),
    history: str(p.diasporaHistory),
    whyJoin: str(p.whyJoin),
    differentiator: str(p.differentiator),
    projectStatus: PROJECT_STATUS.includes(p.projectStatus as ProjectStatus) ? (p.projectStatus as ProjectStatus) : null,
    projectStage: str(p.projectStage, 80),
    startWindow: str(p.startWindow, 80),
    clientOnSiteDaily: bool(p.clientOnSiteDaily),
    offsiteReason: str(p.offsiteReason, 80),
    offsiteOther: str(p.offsiteOther, 500),
    useGroundwork: GROUNDWORK_USE.includes(p.useGroundwork as GroundworkUse) ? (p.useGroundwork as GroundworkUse) : null,
    page: page(p.page) ?? 0,
    pageStack: Array.isArray(p.pageStack) ? p.pageStack.map(page).filter((n): n is number => n !== null).slice(0, MAX_PAGE) : [],
  };

  const answered = [restored.callLang, restored.years, restored.operatesAs, restored.capacity,
    restored.regions.trim(), restored.whyJoin.trim(), restored.differentiator.trim()].filter(Boolean).length
    + (restored.projectStatus !== null ? 1 : 0)
    + (restored.clientOnSiteDaily !== null ? 1 : 0)
    + (restored.useGroundwork !== null ? 1 : 0);
  if (answered === 0) return null;

  // A page the stack cannot explain is a page we cannot have reached by pressing Next.
  // Resume at the last page the stack vouches for, so Back still works from there.
  if (restored.page > 0 && restored.pageStack.length === 0) {
    restored.page = 0;
  }
  return restored;
}
