import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Building2, FileText, Banknote, ShieldCheck, FileSearch } from 'lucide-react';
import { loadContractorOversight, type OversightData } from '@/lib/supabase/contractor-oversight';
import {
  assignmentsFor, acceptedProjectIds, verificationContext, updatesFor, paymentsFor,
} from '@/lib/admin/contractor-oversight';
import type { DirectoryEntry } from '@/lib/supabase/admin-applications';
import { formatUSDFull } from '@/lib/budget';
import { formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// What Groundwork holds about one contractor (01 §3 PEOPLE).
//
// ── Manage the actor; never become the actor ─────────────────────────────────────────
// Everything here is a READ plus a link. There is no evidence upload, no stage
// completion, no verification decision and no payout — those are /work, /verifiers and
// the ledger respectively, and copying any of them here would make an admin able to act
// as somebody else. The only writes on this surface are the directory's own
// active/delete controls, which already existed and belong to the directory.
//
// Every number is labelled with what it counts. Nothing is a score. See
// src/lib/admin/contractor-oversight.ts for the three columns that look like metrics and
// are not.
// =========================================================

export function ContractorOversight({ contractor }: { contractor: DirectoryEntry }) {
  const t = useT();
  const [data, setData] = useState<OversightData | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    loadContractorOversight(contractor.email)
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [contractor.email]);

  const model = useMemo(() => {
    if (!data) return null;
    const assignments = data.invites ? assignmentsFor(contractor.email, data.invites, data.projects) : null;
    const accepted = acceptedProjectIds(assignments ?? []);
    return {
      assignments,
      accepted,
      verification: data.verifications && data.invites
        ? verificationContext(accepted, data.verifications, data.invites, contractor.email)
        : null,
      updates: data.updates ? updatesFor(data.personId, accepted, data.updates) : null,
      payments: data.payments ? paymentsFor(data.personId, data.payments) : null,
    };
  }, [data, contractor.email]);

  if (data === undefined) {
    return <p className="flex items-center gap-2 px-5 py-6 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>;
  }
  if (data === null || !model) {
    return <p className="px-5 py-6 text-xs text-brand-mid-grey">{t('admin.oversight.unavailable')}</p>;
  }

  // No email address means no bridge to anything: 029 assigns by address, so there is
  // nothing to match on and nothing is shown rather than something guessed from a name.
  if (!contractor.email) {
    return <p className="px-5 py-6 text-xs text-brand-mid-grey">{t('admin.oversight.noEmail')}</p>;
  }

  return (
    <div className="divide-y divide-brand-border-grey text-xs">
      {/* ── Assignments ───────────────────────────────────────────────── */}
      <Panel icon={<Building2 className="size-3.5" />} title={t('admin.oversight.assignments')} note={t('admin.oversight.matchedByEmail')}>
        {model.assignments === null ? <Unavailable /> : model.assignments.length === 0 ? (
          <Empty text={t('admin.oversight.noAssignments')} />
        ) : (
          <ul className="space-y-1.5">
            {model.assignments.map(a => (
              <li key={a.projectId} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link to={`/admin/projects/${a.projectId}`} className="font-medium text-brand-near-black underline-offset-2 hover:underline">
                  {a.project?.name ?? t('admin.oversight.projectGone')}
                </Link>
                <span className="text-brand-mid-grey">
                  {t(a.status === 'accepted' ? 'admin.oversight.accepted' : 'admin.oversight.invitedNotAccepted')}
                  {a.since && <> · {formatRelative(a.since)}</>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Verification history: context, and said to be context ─────── */}
      <Panel icon={<ShieldCheck className="size-3.5" />} title={t('admin.oversight.verification')}
             note={model.verification?.shared ? t('admin.oversight.sharedProjects') : t('admin.oversight.notAScore')}>
        {model.verification === null ? <Unavailable /> : model.verification.total === 0 ? (
          <Empty text={t('admin.oversight.noVerifications')} />
        ) : (
          <ul className="space-y-1">
            {Object.entries(model.verification.byDecision).map(([decision, n]) => (
              <li key={decision} className="flex items-baseline justify-between gap-3">
                <span className="text-brand-mid-grey">{t(`verifier.decision.${decision}` as TKey)}</span>
                <span className="font-semibold tabular-nums text-brand-near-black">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Evidence they filed themselves ────────────────────────────── */}
      <Panel icon={<FileText className="size-3.5" />} title={t('admin.oversight.siteUpdates')}
             note={data.personId ? null : t('admin.oversight.noAccount')}>
        {model.updates === null ? <Unavailable /> : !data.personId ? null : model.updates.length === 0 ? (
          <Empty text={t('admin.oversight.noUpdates')} />
        ) : (
          <p className="text-brand-near-black">
            {t('admin.oversight.updateCount', { n: model.updates.length })}
            {model.updates[0]?.submittedAt && <span className="text-brand-mid-grey"> · {t('admin.oversight.latest', { when: formatRelative(model.updates[0].submittedAt) })}</span>}
          </p>
        )}
      </Panel>

      {/* ── Groundwork's own record of money out ──────────────────────── */}
      <Panel icon={<Banknote className="size-3.5" />} title={t('admin.oversight.payments')} note={t('admin.oversight.paymentsNote')}>
        {model.payments === null ? <Unavailable /> : !data.personId ? (
          <Empty text={t('admin.oversight.noAccount')} />
        ) : model.payments.length === 0 ? (
          <Empty text={t('admin.oversight.noPayments')} />
        ) : (
          <ul className="space-y-1.5">
            {model.payments.slice(0, 5).map((p, i) => (
              <li key={`${p.projectId}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2">
                {p.projectId ? (
                  <Link to={`/admin/projects/${p.projectId}?tab=financials`} className="font-medium text-brand-near-black underline-offset-2 hover:underline">
                    {data.projects.get(p.projectId)?.name ?? t('admin.oversight.projectGone')}
                  </Link>
                ) : <span className="text-brand-mid-grey">{t('admin.oversight.noProject')}</span>}
                <span className="tabular-nums text-brand-mid-grey">
                  {formatUSDFull(p.amount)} · {t(`admin.ledger.state.${p.state}` as TKey)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Where this entry came from ────────────────────────────────── */}
      {contractor.applicationId && (
        <Panel icon={<FileSearch className="size-3.5" />} title={t('admin.oversight.provenance')} note={null}>
          <Link to="/admin/applications" className="font-medium text-brand-near-black underline-offset-2 hover:underline">
            {t('admin.oversight.fromApplication')}
          </Link>
        </Panel>
      )}
    </div>
  );
}

function Panel({ icon, title, note, children }: { icon: React.ReactNode; title: string; note: string | null; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{icon}{title}</p>
      <div className="mt-1.5">{children}</div>
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-brand-mid-grey">{note}</p>}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-brand-mid-grey">{text}</p>;

/** Unreadable, which is not none and not zero. */
function Unavailable() {
  const t = useT();
  return <p className="text-brand-mid-grey">{t('admin.oversight.domainUnavailable')}</p>;
}
