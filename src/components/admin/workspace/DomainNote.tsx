import type { DomainState } from '@/lib/admin/workspace-params';
import { useT, type TKey } from '@/lib/i18n';

/**
 * The honest sentence for a domain that is not merely empty: the migration behind it is
 * not applied, or the read failed. Shared by every tab so the two never blur into a zero.
 */
export function DomainNote({ state, reason }: { state: DomainState; reason?: string }) {
  const t = useT();
  const key: TKey = state === 'error' ? 'admin.workspace.overview.domain.error' : 'admin.workspace.overview.domain.unavailable';
  return <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t(key, { reason: reason ?? '' })}</p>;
}
