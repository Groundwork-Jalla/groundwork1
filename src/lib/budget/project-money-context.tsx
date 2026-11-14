import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { formatUSDFull } from '@/lib/budget';
import { useProjectMoney, type ProjectMoney } from './use-project-money';
import type { ProjectMoneySource } from './project-money';

// All project surfaces share one budget conversion. Market quotes never revalue saved balances.


const ProjectMoneyContext = createContext<ProjectMoney | null>(null);

export function ProjectMoneyProvider({ country, project, children }: {
  /** `projects.country` — a two-letter code. */
  country?: string | null;
  project?: ProjectMoneySource;
  children: ReactNode;
}) {
  const money = useProjectMoney(project ?? country);
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
export function useMoney(): (usd: number | null | undefined, sourceAmount?: number | null) => string {
  const money = useContext(ProjectMoneyContext);
  return useMemo(
    () => (usd: number | null | undefined, sourceAmount?: number | null) => {
      const value = Number(usd ?? 0);
      if (!Number.isFinite(value)) return formatUSDFull(0);
      return money?.local(value, sourceAmount) ?? formatUSDFull(value);
    },
    [money],
  );
}

/** The whole helper, for the few places that want the currency code or the rate itself. */
export function useProjectMoneyContext(): ProjectMoney | null {
  return useContext(ProjectMoneyContext);
}
