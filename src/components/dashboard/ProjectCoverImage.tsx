import { useT } from '@/lib/i18n';

/** Stage evidence is not a chosen cover photo. Use the neutral project illustration. */
export function ProjectCoverImage({ projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  return <div role="img" aria-label={`${t('dashboard.architecture.photoPlaceholder')} — ${projectName}`} className="relative flex aspect-[2.8/1] min-w-0 items-center justify-center overflow-hidden bg-[#f2f1ee] dark:bg-[#202520] sm:aspect-auto sm:min-h-64">
      <svg viewBox="0 0 440 260" fill="none" aria-hidden className="w-4/5 max-w-md text-brand-green/55 dark:text-white/40">
        <path d="M24 222H416M65 212V106L220 48L375 106V212M65 116L220 62L375 116M80 124V212M220 62V212M360 124V212M81 212H359M111 152H171V212H111ZM260 146H322V185H260ZM65 106L220 156L375 106M220 156V212" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M46 93V229M394 93V229M35 103H57M35 212H57M383 103H405M383 212H405M86 239H354M86 233V245M220 233V245M354 233V245" stroke="currentColor" strokeWidth=".6" />
      </svg>
      <span className="absolute bottom-4 left-5 text-[10px] font-medium uppercase tracking-[.16em] text-brand-mid-grey">{t('dashboard.architecture.photoPlaceholder')}</span>
  </div>;
}
