import { useState } from 'react';
import { Link } from 'react-router';
import { Camera, ChevronRight } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { DomainNote } from './DomainNote';
import { EvidenceList } from './EvidenceList';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PersonInitials } from './PersonInitials';

// =========================================================
// Site Updates tab (05 §6): the chronological feed of `site_updates` (088), newest first.
//
// Every entry is a record a member wrote through `submit_site_update()` — author, stage,
// substage, description, the files it added. Read-only for staff by decision (13 Sep:
// no admin "submit on behalf"); the client page already lets an admin submit as
// themselves. Files open through the existing signed-URL reader, working for staff
// since 092. Empty means empty: nothing is manufactured to fill the feed.
// =========================================================

export function SiteUpdatesTab({ loaded }: { loaded: LoadedWorkspace }) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'siteUpdates', ws.siteUpdates.length);
  const [stage, setStage] = useState<string | null>(null);
  const [reporter, setReporter] = useState<string | null>(null);

  if (state === 'unavailable' || state === 'error') {
    return <div className="p-6 sm:p-8"><DomainNote state={state} reason={loaded.errors.siteUpdates} /></div>;
  }
  if (state === 'empty') {
    return (
      <div className="p-6 sm:p-8">
        <EmptyState icon={<Camera className="size-8" />} title={t('admin.workspace.siteUpdates.empty')} description={t('admin.workspace.siteUpdates.emptyBody')} />
      </div>
    );
  }

  const stageOf = (id: string) => ws.stages.find(s => s.stage.id === id);
  const who = (id: string) => {
    const hit = ws.team.owner?.id === id ? ws.team.owner
      : ws.team.contractors.find(c => c.contractor_user_id === id) ? { name: ws.team.contractors.find(c => c.contractor_user_id === id)!.name }
      : ws.team.verifiers.find(v => v.userId === id);
    return hit ? (hit.name || ('email' in hit ? hit.email : '')) : '';
  };
  /** What the reporter is to this project — the only role words the feed uses. */
  const roleOf = (id: string): TKey | null =>
    ws.team.owner?.id === id ? 'admin.workspace.ui.role.homeowner'
    : ws.team.contractors.some(c => c.contractor_user_id === id) ? 'admin.workspace.ui.role.contractor'
    : ws.team.verifiers.some(v => v.userId === id) ? 'admin.workspace.ui.role.verifier'
    : null;

  // The feed as assembled (newest first), then the two client-side filters (18 Nov redesign).
  const rows = ws.siteUpdates.map(u => ({ u, view: stageOf(u.stageId) }));
  const count = (pred: (r: typeof rows[number]) => boolean) => rows.filter(pred).length;
  const stageIds = [...new Set(rows.map(r => r.u.stageId))];
  const reporters = [...new Set(rows.map(r => r.u.submittedBy))];
  const shown = rows.filter(r => (!stage || r.u.stageId === stage) && (!reporter || r.u.submittedBy === reporter));

  // Grouped by calendar day, in the order the feed already has.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayLabel = (iso: string) => {
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    return diff === 0 ? t('admin.workspace.ui.today') : diff === 1 ? t('admin.workspace.ui.yesterday') : formatDate(iso);
  };
  const days: { label: string; items: typeof rows }[] = [];
  for (const r of shown) {
    const label = dayLabel(r.u.submittedAt);
    if (days.at(-1)?.label === label) days.at(-1)!.items.push(r); else days.push({ label, items: [r] });
  }

  return (
    <div className="grid items-start gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:p-8">
      <div className="min-w-0">
        {days.length === 0 && (
          <p className="rounded-2xl border border-brand-border-grey bg-white px-5 py-8 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {t('admin.workspace.ui.noMatch')}
          </p>
        )}
        {days.map(day => (
          <section key={day.label} className="mb-5">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-muted-grey">{day.label}</h2>
            <ol className="flex flex-col gap-3">
              {day.items.map(({ u, view }) => {
                const sub = view?.substages.find(s => s.id === u.substageId) ?? null;
                const name = who(u.submittedBy);
                return (
                  <li key={u.id} className="rounded-2xl border border-brand-border-grey bg-white p-4 sm:p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <p className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-brand-near-black dark:text-white">
                        <PersonInitials name={name} tone={roleOf(u.submittedBy) === 'admin.workspace.ui.role.homeowner' ? 'green' : 'held'} />
                        <span className="truncate">{name || t('admin.workspace.header.unknownAccount')}</span>
                        <span className="shrink-0 font-normal text-brand-mid-grey">· <span title={formatDateTime(u.submittedAt)}>{formatRelative(u.submittedAt)}</span></span>
                      </p>
                      {view && (
                        <Link to={workspaceHref(ws.project.id, { tab: 'overview', stageId: view.stage.id })}
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-brand-border-grey px-3 py-1 text-xs text-brand-mid-grey transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:border-[#2c2c2c] dark:hover:text-white">
                          <span className="truncate">{t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })} · {stageLabel(view.stage)}{sub && ` · ${substageLabel(sub)}`}</span>
                          <ChevronRight className="size-3 shrink-0" />
                        </Link>
                      )}
                    </div>
                    {u.description
                      ? <p className="mt-3 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">{u.description}</p>
                      : <p className="mt-3 text-sm text-brand-mid-grey">{t('admin.workspace.siteUpdates.noDescription')}</p>}
                    {u.evidencePaths.length > 0 && <div className="mt-3"><EvidenceList paths={u.evidencePaths} thumbnails /></div>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {/* The rail: who reported, about which stage — both counted from the rows above. */}
      <aside className="rounded-2xl border border-brand-border-grey bg-white p-4 lg:sticky lg:top-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h3 className="px-1 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-muted-grey">{t('admin.workspace.ui.stage')}</h3>
        <ul className="mt-1.5 space-y-0.5">
          <FilterRow on={!stage} onClick={() => setStage(null)} label={t('admin.workspace.ui.allStages')} n={rows.length} />
          {stageIds.map(id => {
            const v = stageOf(id);
            return <FilterRow key={id} on={stage === id} onClick={() => setStage(id)}
              label={v ? `${v.stage.stage_number} · ${stageLabel(v.stage)}` : t('admin.workspace.header.unknownAccount')}
              n={count(r => r.u.stageId === id)} />;
          })}
        </ul>
        <h3 className="mt-4 px-1 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-muted-grey">{t('admin.workspace.ui.reportedBy')}</h3>
        <ul className="mt-1.5 space-y-0.5">
          <FilterRow on={!reporter} onClick={() => setReporter(null)} label={t('admin.workspace.ui.everyone')} n={rows.length} />
          {reporters.map(id => {
            const role = roleOf(id);
            return <FilterRow key={id} on={reporter === id} onClick={() => setReporter(id)}
              label={`${who(id) || t('admin.workspace.header.unknownAccount')}${role ? ` · ${t(role)}` : ''}`}
              n={count(r => r.u.submittedBy === id)} />;
          })}
        </ul>
        <p className="mt-4 px-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.workspace.siteUpdates.emptyBody')}</p>
        <p className="mt-2 px-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.workspace.ui.pillHint')}</p>
      </aside>
    </div>
  );
}

function FilterRow({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-pressed={on}
        className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
          on ? 'bg-[#f3f6f4] font-semibold text-brand-green dark:bg-[#1c2620] dark:text-state-complete' : 'text-brand-near-black hover:bg-brand-off-white dark:text-white dark:hover:bg-[#252525]')}>
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-brand-mid-grey">{n}</span>
      </button>
    </li>
  );
}
