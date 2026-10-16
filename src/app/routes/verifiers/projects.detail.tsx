import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Check, Layers, Loader2, Paperclip } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { loadProjectForVerifier, signedFileUrl, type VerifierProject, type VerifierStage }
  from '@/lib/supabase/verifier-work';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';
import { ProjectConversations } from '@/components/project/ProjectConversations';

/**
 * A project, as the verifier assigned to it arrives at it.
 *
 * ── Why the whole project and not one verification ──────────────────────────────────
 * Two links land here and both mean "the build", not "this stage": the assignment email
 * (130) says you are verifying a project, and a message notification (123/125) names a
 * project. `/verifiers/:id` is a VERIFICATION and answers a narrower question — judge
 * this one stage — which is the wrong first screen for somebody who has just been told
 * they are on a job. The first thing they need is what state it is in and what the
 * contractor has put up against each stage.
 *
 * Neither link resolved before this page existed: `/verifiers/projects/<id>` was built by
 * 123 and 125 against a surface that had only `/verifiers` and `/verifiers/:id`.
 *
 * ── It judges nothing ───────────────────────────────────────────────────────────────
 * Recording a finding stays in the verification workspace, reached from a stage here.
 * This page reads. The decision belongs where the evidence for that one stage is laid
 * out beside the question being asked, not next to nine other stages.
 */
export default function VerifierProjectPage() {
  const t = useT();
  const { projectId = '' } = useParams();
  const { user } = useAuth();
  const { stageLabel } = useStageLabels();
  const [data, setData]   = useState<VerifierProject | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !user) return;
    let live = true;
    void loadProjectForVerifier(projectId, user.id)
      .then(p => {
        if (!live) return;
        // Null means RLS refused the project — the assignment is not active. Said
        // plainly: an empty page reads as the product being broken.
        if (!p) { setState('denied'); return; }
        setData(p); setState('ready');
      })
      .catch(err => { if (live) { setError(errorMessage(err, t('common.somethingWrong'))); setState('error'); } });
    return () => { live = false; };
  }, [projectId, user, t]);

  if (state === 'loading') {
    return <p role="status" className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }
  if (state === 'denied') {
    return <div className="max-w-3xl space-y-3"><Back />
      <p role="status" className="rounded-xl border border-brand-border-grey p-5 text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
        {t('verifier.project.noAccess')}
      </p></div>;
  }
  if (state === 'error' || !data) {
    return <div className="max-w-3xl space-y-3"><Back />
      <p role="alert" className="rounded-xl border border-state-alert/40 bg-state-alert/5 p-5 text-sm text-state-alert">{error}</p>
    </div>;
  }

  const place = [data.city, data.country].filter(Boolean).join(', ');

  return (
    <div className="max-w-3xl space-y-5">
      <Back />
      <div>
        <h1 className="text-xl font-semibold text-brand-near-black dark:text-white">{data.projectName}</h1>
        {place && <p className="text-sm text-brand-mid-grey mt-0.5">{place}</p>}
      </div>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-brand-near-black dark:text-white">
          <Layers className="size-4" />{t('verifier.project.stages')}
        </h2>
        {data.stages.length === 0 ? (
          <p className="text-sm text-brand-mid-grey">{t('verifier.project.noStages')}</p>
        ) : (
          <ul className="space-y-2">
            {data.stages.map(st => <StageCard key={st.id} stage={st} label={stageLabel({ name: st.name, stage_key: st.stageKey })} />)}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.tabs.messages')}</h2>
        <ProjectConversations projectId={data.projectId} projectName={data.projectName} />
      </section>
    </div>
  );
}

function StageCard({ stage, label }: { stage: VerifierStage; label: string }) {
  const t = useT();
  const evidence = stage.substages.flatMap(s => s.evidence);

  return (
    <li className="rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-md bg-brand-off-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-mid-grey dark:bg-[#2c2c2c]">
          {stage.stageNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">{label}</p>
          <p className="text-[11px] text-brand-mid-grey mt-0.5">
            {t('verifier.project.evidenceCount', { count: evidence.length })}
            {stage.decision && stage.decision !== 'pending' && ` · ${t(`verifier.decision.${stage.decision}` as never)}`}
          </p>
        </div>
        {/* Only where a verification of theirs exists. Without one there is nothing to
            record against, and a button leading to a 404 is worse than no button. */}
        {stage.verificationId && (
          <Link to={`/verifiers/${stage.verificationId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand-border-grey px-2.5 py-1 text-[11px] font-semibold hover:bg-brand-off-white dark:border-[#444] dark:hover:bg-[#2c2c2c]">
            {stage.decision === 'pending' ? t('verifier.project.verify') : t('verifier.project.review')}
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>

      {stage.substages.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-brand-border-grey pt-3 dark:border-[#2c2c2c]">
          {stage.substages.map(s => (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              <Check className={cn('mt-0.5 size-3 shrink-0',
                s.status === 'complete' ? 'text-state-active' : 'text-brand-border-grey')} />
              <span className="min-w-0 flex-1 text-brand-near-black dark:text-white">{s.name}</span>
              {s.evidence.length > 0 && <EvidenceLinks paths={s.evidence} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * What the contractor put up, openable.
 *
 * The bucket is private and there is no public path to it: each link is signed on demand
 * and lasts an hour, which is also why the URL is fetched on click rather than for every
 * file on the page at load.
 */
function EvidenceLinks({ paths }: { paths: string[] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function open(path: string) {
    setBusy(true);
    try {
      const url = await signedFileUrl('evidence', path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally { setBusy(false); }
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {paths.map((p, i) => (
        <button key={p} type="button" disabled={busy} onClick={() => { void open(p); }}
          aria-label={t('verifier.project.openEvidence', { n: i + 1 })}
          className="inline-flex items-center gap-0.5 text-brand-mid-grey hover:text-brand-near-black disabled:opacity-40 dark:hover:text-white">
          <Paperclip className="size-3" />
          <span className="text-[10px] tabular-nums">{i + 1}</span>
        </button>
      ))}
    </span>
  );
}

function Back() {
  const t = useT();
  return <Link to="/verifiers" className="inline-flex items-center gap-1.5 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
    <ArrowLeft className="size-3.5" />{t('verifier.project.back')}
  </Link>;
}
