import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { signedUrlIn } from '@/lib/supabase/documents';
import { useT } from '@/lib/i18n';

/** The project's own private site photo; an architectural outline when no photo can be read. */
export function ProjectCoverImage({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  const [photo, setPhoto] = useState<{ projectId: string; path: string; url: string; original: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setPhoto(null);
    void (async () => {
      try {
        const { data, error } = await supabase.from('project_substages').select('evidence_urls').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100);
        if (error || !live) return;
        const path = (data ?? []).flatMap(row => Array.isArray(row.evidence_urls) ? row.evidence_urls : []).find((value: unknown): value is string => typeof value === 'string' && /\.(jpe?g|png|webp)$/i.test(value));
        if (!path) return;
        const url = await signedUrlIn('evidence', path, { width: 960, height: 600 });
        if (live && url) setPhoto({ projectId, path, url, original: false });
      } catch { /* A site without a readable photograph still has a usable dashboard. */ }
    })();
    return () => { live = false; };
  }, [projectId]);
  const current = photo?.projectId === projectId ? photo : null;
  return <div className="relative flex aspect-[2.8/1] min-w-0 items-center justify-center overflow-hidden bg-[#f2f1ee] dark:bg-[#202520] sm:aspect-auto sm:min-h-64">
    {current ? <img src={current.url} alt={t('dashboard.architecture.sitePhoto', { name: projectName })} className="absolute inset-0 size-full object-cover" onError={() => {
      if (current.original) { setPhoto(value => value?.url === current.url ? null : value); return; }
      void signedUrlIn('evidence', current.path)
        .then(url => setPhoto(value => value?.projectId === projectId && value.url === current.url ? url ? { ...value, url, original: true } : null : value))
        .catch(() => setPhoto(value => value?.url === current.url ? null : value));
    }} /> : <>
      <svg viewBox="0 0 440 260" fill="none" aria-hidden className="w-4/5 max-w-md text-brand-green/55 dark:text-white/40">
        <path d="M24 222H416M65 212V106L220 48L375 106V212M65 116L220 62L375 116M80 124V212M220 62V212M360 124V212M81 212H359M111 152H171V212H111ZM260 146H322V185H260ZM65 106L220 156L375 106M220 156V212" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M46 93V229M394 93V229M35 103H57M35 212H57M383 103H405M383 212H405M86 239H354M86 233V245M220 233V245M354 233V245" stroke="currentColor" strokeWidth=".6" />
      </svg>
      <span className="absolute bottom-4 left-5 text-[10px] font-medium uppercase tracking-[.16em] text-brand-mid-grey">{t('dashboard.architecture.photoPlaceholder')}</span>
    </>}
  </div>;
}
