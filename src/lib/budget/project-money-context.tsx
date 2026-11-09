import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { formatUSDFull } from '@/lib/budget';
import { useProjectMoney, type ProjectMoney } from './use-project-money';

// =========================================================
// One project, one currency, one rate.
//
// Philip, 9 Nov 2026, on a live client's build: the project currency "is mistakenly
// displayed in USD instead of CFA Franc". It is not a mislabel — every figure
// Groundwork stores really is dollars, because the budget engine converts the XAF
// take-off to USD cents before writing `projects.budget_usd`. So the client screens
// were quoting a true number in a currency the client does not pay in.
//
// ── Why a context rather than a prop ──────────────────────────────────────────────
// A project screen renders money in a dozen leaves — stat cards, slice rows, stage
// bars, the payment timeline — several of them nested three deep inside a file. Passing
// a formatter down each path is a lot of edits for one decision, and the moment one
// branch is missed that branch quietly keeps printing dollars, which is exactly the
// failure being fixed. Reading it from context means a figure either converts or the
// component does not compile.
//
// ── Why the rate is fetched, not hardcoded ───────────────────────────────────────
// `useProjectMoney` takes today's rate from the live feed and falls back to the stored
// `approx_fx_rate` (600 XAF/$1 for Cameroon) when it cannot be had. That stored figure
// is a round number somebody typed and is about 3% out, which on a 60M XAF build is a
// few thousand dollars of apparent budget — see live-fx.ts.
//
// ── What this does NOT change ────────────────────────────────────────────────────
// Nothing about what is owed or what moves. The ledger stays denominated in USD, the
// budget engine still divides by the stored rate, and `payment_milestone_usd` is
// untouched. This is a rendering decision and only ever reads.
// =========================================================

const ProjectMoneyContext = createContext<ProjectMoney | null>(null);

export function ProjectMoneyProvider({ country, children }: {
  /** `projects.country` — a two-letter code. */
  country: string | null | undefined;
  children: ReactNode;
}) {
  const money = useProjectMoney(country);
  return <ProjectMoneyContext.Provider value={money}>{children}</ProjectMoneyContext.Provider>;
}

/**
 * Format a stored USD figure in the project's own currency.
 *
 * Outside a provider this falls back to dollars rather than throwing: the same leaf
 * components are rendered by the admin workspace and by exports, where there is no one
 * project whose currency it could be, and a screen that crashes is worse than one that
 * says $ where it has nothing better to say.
 */
export function useMoney(): (usd: number | null | undefined) => string {
  const money = useContext(ProjectMoneyContext);
  return useMemo(
    () => (usd: number | null | undefined) => {
      const value = Number(usd ?? 0);
      if (!Number.isFinite(value)) return formatUSDFull(0);
      return money?.local(value) ?? formatUSDFull(value);
    },
    [money],
  );
}

/** The whole helper, for the few places that want the currency code or the rate itself. */
export function useProjectMoneyContext(): ProjectMoney | null {
  return useContext(ProjectMoneyContext);
}
