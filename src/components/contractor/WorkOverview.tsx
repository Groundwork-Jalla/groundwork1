import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, FileText, Upload, ArrowRight, Image, Loader2 } from 'lucide-react';
import { fetchProjectDocuments, fetchSubstages, signEvidenceUrl, type AssignedProject, type ContractorPayment } from '@/lib/supabase/contractor-work';
import { supabase } from '@/lib/supabase/client';
import type { ProjectDocumentRow } from '@/types/project';
import { useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const panel = 'min-w-0 rounded-2xl border border-brand-border-grey bg-[#ffffff] p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';

export function WorkOverview({ projects, payments }: {
  projects: AssignedProject[];
  payments: { rows: ContractorPayment[]; available: boolean } | null;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [selected, setSelected] = useState('');
  const current = projects.find(p => p.project.id === selected) ?? projects[0];
  return <>
    {current && <div className="grid min-w-0 gap-5 xl:grid-cols-[3fr_2fr]">
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-grey pb-4 dark:border-[#2c2c2c]">
          <h2 className="text-sm font-semibold">{t('contractorDashboard.progress')}</h2>
          <select aria-label={t('contractor.projects.title')} value={current.project.id} onChange={e => setSelected(e.target.value)} className="max-w-full rounded-lg border border-brand-border-grey bg-[#ffffff] px-3 py-2 text-xs dark:border-[#444] dark:bg-[#1e1e1e]">
            {projects.map(p => <option key={p.project.id} value={p.project.id}>{p.project.name}</option>)}
          </select>
        </div>
        {current.stages.length === 0 ? <p className="py-8 text-sm text-brand-mid-grey">{t('contractor.projects.noStages')}</p> : <>
          <p className="mt-5 text-xs text-brand-mid-grey">{t('contractor.projects.stageOf', { n: current.completedStages, total: current.totalStages })}</p>
          <ol aria-label={t('contractorProject.pipeline')} tabIndex={0} className="flex overflow-x-auto py-7">
            {current.stages.map(s => <li key={s.id} aria-current={s.id === current.activeStage?.id ? 'step' : undefined} className="relative min-w-24 flex-1 text-center">
              <div aria-hidden="true" className="absolute left-0 right-0 top-4 h-px bg-brand-border-grey" />
              <span className={cn('relative mx-auto flex size-8 items-center justify-center rounded-full border text-xs font-semibold', s.status === 'complete' ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black' : s.id === current.activeStage?.id ? 'border-brand-near-black bg-brand-light-grey text-brand-near-black ring-4 ring-brand-border-grey/40 dark:border-white dark:bg-[#444] dark:text-white' : 'border-brand-border-grey bg-[#ffffff] text-brand-mid-grey dark:bg-[#1e1e1e]')}>
                {s.status === 'complete' ? <Check className="size-4" /> : s.stage_number}
              </span>
              <p className="mt-3 px-1 text-[11px] font-medium">{stageLabel(s)}</p>
              <p className="mt-1 px-1 text-[10px] text-brand-mid-grey">{t(`contractorStageStatus.${s.status}` as TKey)}</p>
            </li>)}
          </ol>
        </>}
      </section>
      <section id="evidence" className={`${panel} scroll-mt-24`}>
        <h2 className="border-b border-brand-border-grey pb-4 text-sm font-semibold dark:border-[#2c2c2c]">{t('contractorDashboard.evidence')}</h2>
        <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-brand-border-grey px-5 py-5 text-center dark:border-[#444]">
          <Upload className="mb-3 size-7 text-brand-mid-grey" />
          <p className="max-w-sm text-xs leading-relaxed text-brand-mid-grey">{t(current.activeStage ? 'contractorDashboard.uploadHint' : 'contractorProject.noActiveStageBody')}</p>
          <Link to={`/work/projects/${current.project.id}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-near-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black">{t('contractor.needsAction.open')}<ArrowRight className="size-3" /></Link>
        </div>
        <Evidence key={`${current.project.id}:${current.activeStage?.id}`} assigned={current} />
      </section>
    </div>}
    <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
      <section id="payments" className={`${panel} scroll-mt-24`}>
        <h2 className="text-sm font-semibold">{t('contractor.kpi.payments')}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-mid-grey">{t('contractorPayments.note')}</p>
        {!payments || !payments.available ? <p className="py-6 text-xs text-brand-mid-grey">{t(payments ? 'contractorPayments.unavailable' : 'common.loading')}</p> : payments.rows.length === 0 ? <p className="py-6 text-xs text-brand-mid-grey">{t('contractorDashboard.noPayments')}</p> : <div className="mt-4 max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]"><tr><th className="p-3 font-medium">{t('contractorPayments.milestone')}</th><th className="p-3 font-medium">{t('contractorDashboard.amount')}</th><th className="p-3 font-medium">{t('contractorDashboard.paymentState')}</th></tr></thead>
            <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">{payments.rows.map(p => <tr key={p.id}>
              <td className="p-3"><p className="font-medium">{projects.find(a => a.project.id === p.projectId)?.project.name ?? t('contractorPayments.milestone')}</p>{p.note && <p className="mt-1 text-brand-mid-grey">{p.note}</p>}</td>
              <td className="whitespace-nowrap p-3 font-semibold tabular-nums">{formatMoney(p.amount, p.currency)}</td>
              <td className="p-3"><span className="inline-block rounded-full bg-brand-off-white px-3 py-1 text-brand-mid-grey dark:bg-[#2c2c2c]">{p.state.replaceAll('_', ' ')}</span></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      {current && <Documents key={current.project.id} assigned={current} />}
    </div>
  </>;
}

function Evidence({ assigned }: { assigned: AssignedProject }) {
  const t = useT();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchSubstages(assigned.project.id).then(rows => {
      if (alive) setPaths([...new Set(rows.filter(s => s.stage_id === assigned.activeStage?.id).flatMap(s => s.evidence_urls))]);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [assigned.project.id, assigned.activeStage?.id]);
  return <div className="mt-4">
    <h3 className="text-xs font-medium">{t('contractorDashboard.recentEvidence')}</h3>
    {failed || paths === null || paths.length === 0 ? <p className="mt-2 text-xs text-brand-mid-grey">{t(failed ? 'contractor.kpi.unavailable' : paths === null ? 'common.loading' : 'contractorDashboard.noEvidence')}</p> : <ul className="mt-2 max-h-36 overflow-y-auto">{paths.map(path => <PrivateFile key={path} path={path} name={path.split('/').pop() ?? path} bucket="evidence" />)}</ul>}
  </div>;
}

function Documents({ assigned }: { assigned: AssignedProject }) {
  const t = useT();
  const [documents, setDocuments] = useState<ProjectDocumentRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchProjectDocuments(assigned.project.id).then(rows => { if (alive) setDocuments(rows); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [assigned.project.id]);
  return <section id="documents" className={`${panel} scroll-mt-24`}>
    <h2 className="text-sm font-semibold">{t('contractorProject.tabDocuments')}</h2>
    <p className="mt-1 text-xs text-brand-mid-grey">{assigned.project.name}</p>
    {failed || documents === null || documents.length === 0 ? <p className="py-6 text-xs text-brand-mid-grey">{t(failed ? 'contractor.kpi.unavailable' : documents === null ? 'common.loading' : 'contractorProject.noDocuments')}</p> : <ul className="mt-3 max-h-64 overflow-y-auto">{documents.map(d => <PrivateFile key={d.id} path={d.file_path} name={d.file_name} bucket="documents" />)}</ul>}
  </section>;
}

function PrivateFile({ path, name, bucket }: { path: string; name: string; bucket: 'evidence' | 'documents' }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  async function open() {
    // Reserve the tab in the click event so signing cannot trigger popup blocking.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true); setFailed(false); setUrl(null);
    try {
      const signed = bucket === 'evidence' ? await signEvidenceUrl(path) : (await supabase.storage.from('documents').createSignedUrl(path, 3600)).data?.signedUrl;
      if (!signed) throw new Error('File unavailable');
      if (tab) tab.location.replace(signed);
      else setUrl(signed);
    } catch { tab?.close(); setFailed(true); }
    finally { setBusy(false); }
  }
  return <li className="flex flex-wrap items-center gap-2 border-b border-brand-border-grey py-2.5 text-xs last:border-0 dark:border-[#2c2c2c]">
    {bucket === 'evidence' ? <Image className="size-4 shrink-0 text-brand-mid-grey" /> : <FileText className="size-4 shrink-0 text-brand-mid-grey" />}
    <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{t('common.open')}</a> : <button type="button" disabled={busy} onClick={() => void open()} aria-label={`${t('common.open')} ${name}`} className="rounded-md border border-brand-border-grey px-2 py-1 disabled:opacity-50 dark:border-[#444]">{busy ? <Loader2 className="size-3 animate-spin" /> : t('common.open')}</button>}
    {failed && <p role="alert" className="w-full text-state-alert">{t('verifier.detail.fileUnavailable')}</p>}
  </li>;
}
