import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, FileImage } from 'lucide-react';
import type { StageView, PersonLookup } from '@/lib/admin/workspace';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate, formatRelative } from '@/lib/format';
import { formatUSDFull } from '@/lib/budget';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The selected stage's operational summary (05 §6 Overview → "current stage").
//
// Everything shown was assembled by the loader into one StageView: the lifecycle, the
// newest verification, the newest site update, the stage's tranche and its latest
// release row. This panel arranges those; it computes none of them. The only thing it
// fetches is a signed URL for an evidence file, through the reader that already exists
// (`getSignedEvidenceUrl`, working for staff since 092) — never a new storage path.
//
// Full stage operations — request verification, approve, rework, authorise release —
// are the Stages tab's (Step 5). This panel ends at a link into it.
// =========================================================

export function SelectedStagePanel({ projectId, view, people, ledgerAvailable }: {
  projectId: string;
  view: StageView;
  people: PersonLookup;
  /** False when 090 is not applied: the money lines say so instead of showing zeros. */
  ledgerAvailable: boolean;
}) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const name = (id: string | null | undefined) => {
    const p = id ? people.get(id) : undefined;
    return p ? (p.name || p.email) : t('admin.workspace.header.unknownAccount');
  };

  // Evidence for the stage: the index on each substage (pre-088) plus every path a site
  // update added (088). Same file may appear in both — de-duplicated by path.
  const evidencePaths = [...new Set([
    ...view.substages.flatMap(s => s.evidence_urls ?? []),
    ...view.siteUpdates.flatMap(u => u.evidencePaths),
  ])];

  const v = view.latestVerification;
  const u = view.siteUpdates[0] ?? null;
  const milestone = view.stage.payment_milestone_usd;
  const decisionKey = v ? (`admin.workspace.stage.decision.${v.decision}` as TKey) : null;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-grey">
            {t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-brand-near-black dark:text-white">{stageLabel(view.stage)}</h3>
          <StageLifecycleBadge lifecycle={view.lifecycle} className="mt-1.5" />
        </div>
        <Link
          to={workspaceHref(projectId, { tab: 'stages', stageId: view.stage.id })}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
        >
          {t('admin.workspace.stage.openInStages')} <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* ── Substages ─────────────────────────────────────────────────────────── */}
        <Section label={t('admin.workspace.stage.substages')}>
          {view.substages.length === 0 ? (
            <Muted>{t('admin.workspace.stage.substagesNone')}</Muted>
          ) : (
            <ul className="space-y-1">
              {view.substages.map(s => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span className={cn('size-1.5 shrink-0 rounded-full',
                    s.status === 'complete' ? 'bg-state-complete' : s.status === 'pending_review' ? 'bg-state-held' : s.status === 'in_progress' ? 'bg-state-active' : 'bg-state-locked')} />
                  <span className="truncate text-brand-near-black dark:text-white">{substageLabel(s)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Evidence ──────────────────────────────────────────────────────────── */}
        <Section label={t('admin.workspace.stage.evidence')}>
          {evidencePaths.length === 0
            ? <Muted>{t('admin.workspace.stage.evidenceNone')}</Muted>
            : <EvidenceList paths={evidencePaths} />}
        </Section>

        {/* ── Latest site update ────────────────────────────────────────────────── */}
        <Section label={t('admin.workspace.stage.latestUpdate')}>
          {!u ? (
            <Muted>{t('admin.workspace.stage.updateNone')}</Muted>
          ) : (
            <>
              {u.description && <p className="text-xs text-brand-near-black dark:text-white">{u.description}</p>}
              <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                {t('admin.workspace.stage.updateBy', { name: name(u.submittedBy), when: formatRelative(u.submittedAt) })}
                {u.evidencePaths.length > 0 && ` · ${t('admin.workspace.stage.evidenceCount', { n: u.evidencePaths.length })}`}
              </p>
            </>
          )}
        </Section>

        {/* ── Latest verification ───────────────────────────────────────────────── */}
        <Section label={t('admin.workspace.stage.latestVerification')}>
          {!v || !decisionKey ? (
            <Muted>{t('admin.workspace.stage.verificationNone')}</Muted>
          ) : (
            <>
              <p className="text-xs text-brand-near-black dark:text-white">
                {t('admin.workspace.stage.verificationLine', {
                  decision: t(decisionKey), name: name(v.verifierId), when: formatRelative(v.decidedAt ?? v.requestedAt),
                })}
              </p>
              <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                {v.visitedAt ? t('admin.workspace.stage.visited', { date: formatDate(v.visitedAt) }) : t('admin.workspace.stage.notVisited')}
                {view.certificateId && ` · ${t('admin.workspace.stage.certificate')}`}
              </p>
            </>
          )}
        </Section>

        {/* ── Money on this stage: what is owed, what came in, what went out ──────── */}
        <Section label={t('admin.workspace.stage.milestone')}>
          {milestone == null || milestone <= 0 ? (
            <Muted>{t('admin.workspace.stage.milestoneNone')}</Muted>
          ) : (
            <p className="text-xs font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(milestone)}</p>
          )}
        </Section>

        <Section label={`${t('admin.workspace.stage.tranche')} · ${t('admin.workspace.stage.release')}`}>
          {!ledgerAvailable ? (
            <Muted>{t('admin.workspace.overview.ledgerUnavailable')}</Muted>
          ) : (
            <>
              <p className="text-xs text-brand-near-black dark:text-white">
                {view.tranche
                  ? `${t(`admin.ledger.state.${view.tranche.state}` as TKey)} · ${formatUSDFull(view.tranche.amount)}`
                  : '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                {view.release
                  ? `${t(`admin.ledger.state.${view.release.state}` as TKey)} · ${formatUSDFull(view.release.amount)}`
                  : t('admin.workspace.stage.releaseNone')}
              </p>
            </>
          )}
        </Section>
      </dl>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-grey">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-brand-mid-grey">{children}</p>;
}

/**
 * Evidence files, each opened through a signed URL fetched on demand. A path that cannot
 * be signed (a deleted object, a bucket policy still missing) is listed and marked, not
 * hidden — the record says a file was there.
 */
function EvidenceList({ paths }: { paths: string[] }) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(paths.slice(0, 12).map(async p => [p, await getSignedEvidenceUrl(p)] as const))
      .then(pairs => { if (alive) setUrls(Object.fromEntries(pairs)); })
      .catch(() => { /* every entry stays "unsigned" and renders as such */ });
    return () => { alive = false; };
  }, [paths]);

  return (
    <div>
      <p className="text-xs text-brand-near-black dark:text-white">{t('admin.workspace.stage.evidenceCount', { n: paths.length })}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {paths.slice(0, 12).map((p, i) => {
          const url = urls[p];
          const label = t('admin.workspace.stage.evidenceOpen', { n: i + 1 });
          const cls = 'inline-flex size-8 items-center justify-center rounded-lg border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]';
          return (
            <li key={p}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}
                  className={cn(cls, 'transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:hover:border-white dark:hover:text-white')}>
                  <FileImage className="size-3.5" />
                </a>
              ) : (
                <span title={p} className={cn(cls, 'opacity-50')}><FileImage className="size-3.5" /></span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
