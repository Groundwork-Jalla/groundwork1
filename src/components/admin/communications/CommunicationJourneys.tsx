import { useState } from 'react';
import { useLanguage,useT } from '@/lib/i18n';
import { copyFor,ctaPath,stepTimeline } from '../../../../shared/lifecycle-copy.js';
import { ACTIVATION_JOURNEYS,journeyPreviewContext,type JourneyId,type JourneySequence,type JourneyStep } from '@/lib/lifecycle/journeys';

const BRANCHES={ci_onboarding:'onboardingNeeded',ci_connected_existing:'alreadyOnboarded',ci_connected_new:'afterOnboarding',cl_support:'supportRequested',cl_contractor_pending:'contractorInvited'} as const;
export function CommunicationJourneys({sequences,steps,onEdit}:{sequences:JourneySequence[];steps:JourneyStep[];onEdit:(journey:JourneyId)=>void}) {
  const t=useT();const {lang}=useLanguage();const [previewLang,setPreviewLang]=useState<'en'|'fr'>(lang);
  const [selected,setSelected]=useState<{sequence:string;step:string}|null>(null);
  const sequence=sequences.find(item=>item.key===selected?.sequence);
  const message=steps.find(item=>item.sequence_key===sequence?.key&&item.id===selected?.step);
  const sample=sequence?journeyPreviewContext(sequence,previewLang):null;
  const copy=message&&sample?copyFor(message,previewLang,sample.person,sample.context):null;
  const path=message&&sample?ctaPath(message.cta_key,sample.context):null;
  const timing=(hours:number)=>t(hours===0?'communications.journeys.immediate':hours%24===0?'communications.journeys.day':'communications.journeys.hours',{count:hours%24===0?hours/24:hours});
  return <section>
    <h2 className="text-lg font-semibold">{t('communications.journeys.title')}</h2>
    <p className="mt-2 max-w-3xl text-sm text-brand-mid-grey">{t('communications.journeys.help')}</p>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">{ACTIVATION_JOURNEYS.map(journey=>{
      const stages=journey.sequences.map(key=>sequences.find(item=>item.key===key)).filter((item):item is JourneySequence=>!!item);
      return <article key={journey.id} className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:bg-[#181818]">
        <h3 className="font-semibold">{t(`communications.journeys.titles.${journey.id}`)}</h3>
        <p className="mt-2 text-xs text-brand-mid-grey">{t(`communications.journeys.outcomes.${journey.id}`)}</p>
        {!stages.length&&<p className="mt-3 text-sm">{t('communications.journeys.empty')}</p>}
        <ol className="mt-4 space-y-4">{stages.map(stage=>{
          const timeline=stepTimeline(steps.filter(item=>item.sequence_key===stage.key));
          const branch=BRANCHES[stage.key as keyof typeof BRANCHES];
          return <li key={stage.key} className="border-l-2 border-brand-green/30 pl-3">
            <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{t(`communications.journeys.stages.${stage.key as typeof ACTIVATION_JOURNEYS[number]['sequences'][number]}`)}</p><span className="text-xs text-brand-mid-grey">{t(stage.enabled?'communications.journeys.enabled':'communications.journeys.paused')}</span></div>
            {branch&&<p className="mt-1 text-xs text-brand-mid-grey">{t(`communications.journeys.branches.${branch}`)}</p>}
            <ul className="mt-2 flex flex-wrap gap-2">{timeline.map(({step,hoursFromEntry})=><li key={step.id}><button type="button" aria-pressed={selected?.step===step.id} onClick={()=>setSelected({sequence:stage.key,step:step.id})} className="rounded-xl border px-2 py-1 text-xs hover:border-brand-green">
              {step.code||step.position} · {timing(hoursFromEntry)}
            </button></li>)}</ul>
            {stage.followup_after_days!==null&&<p className="mt-2 text-xs text-brand-mid-grey">{t('communications.journeys.humanFollowup',{count:Math.max(stage.followup_after_days,(timeline.at(-1)?.hoursFromEntry??0)/24)})}</p>}
          </li>;
        })}</ol>
        <button type="button" onClick={()=>onEdit(journey.id)} className="mt-4 rounded-xl border px-3 py-2 text-sm">{t('communications.journeys.edit')}</button>
      </article>;
    })}</div>
    {copy&&message&&<section className="mt-6 rounded-2xl border border-brand-green/30 bg-white p-5 dark:bg-[#181818]">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t('communications.journeys.preview')} · {message.code||message.position}</h3>
        <label className="text-sm">{t('communications.journeys.language')} <select value={previewLang} onChange={event=>setPreviewLang(event.target.value as 'en'|'fr')} className="ml-2 rounded-xl border bg-transparent px-3 py-2"><option value="en">English</option><option value="fr">Français</option></select></label></div>
      <p className="mt-2 text-xs text-brand-mid-grey">{t('communications.journeys.exampleOnly')}</p>
      <p className="mt-4 font-semibold">{copy.subject}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{copy.body}</p>
      {copy.cta&&path&&<div className="mt-4"><span className="inline-block rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white">{copy.cta}</span><p className="mt-2 break-all text-xs text-brand-mid-grey">{t('communications.journeys.destination')} {path}</p></div>}
    </section>}
  </section>;
}
