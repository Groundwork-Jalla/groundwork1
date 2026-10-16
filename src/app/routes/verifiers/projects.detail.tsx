import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useT } from '@/lib/i18n';
import { ProjectConversations } from '@/components/project/ProjectConversations';

/**
 * A project, as the verifier assigned to it sees it — which is the conversation.
 *
 * ── Why this route exists ───────────────────────────────────────────────────────────
 * 123 and 125 build `/verifiers/projects/<id>?tab=messages` for a verifier's message
 * notification, and that route did not exist: the surface had only `/verifiers` and
 * `/verifiers/:id`, where `:id` is a VERIFICATION, not a project. So every message
 * notification sent to a verifier was a dead link — bell and email alike.
 *
 * Two ways to fix it, and this is the better one. Pointing the link at `/verifiers`
 * instead would have stopped the 404 while quietly keeping the original complaint: you
 * are told about a message and dropped somewhere that does not show it.
 *
 * ── What it deliberately does not show ──────────────────────────────────────────────
 * Not the verification workspace — that is `/verifiers/:id`, reached from the work list,
 * and a verifier records findings against an assignment rather than against a project.
 * This is the thread, because a message is what brought them here. RLS does the rest: a
 * verifier is a project member only while actively assigned (086), so an old assignment
 * stops resolving rather than lingering.
 */
export default function VerifierProjectMessages() {
  const t = useT();
  const { projectId = '' } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        // No row means RLS refused it — they are not assigned to this build any more.
        // Said plainly rather than rendered as an empty chat.
        if (!data) { setMissing(true); return; }
        setName((data.name as string | null) ?? '');
      });
    return () => { live = false; };
  }, [projectId]);

  if (missing) {
    return <div className="max-w-3xl space-y-3">
      <Back />
      <p role="status" className="rounded-xl border border-brand-border-grey p-5 text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
        {t('verifier.project.noAccess')}
      </p>
    </div>;
  }
  if (name === null) {
    return <p role="status" className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Back />
      <h1 className="text-xl font-semibold text-brand-near-black dark:text-white">{name}</h1>
      <ProjectConversations projectId={projectId} projectName={name} />
    </div>
  );
}

function Back() {
  const t = useT();
  return <Link to="/verifiers" className="inline-flex items-center gap-1.5 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
    <ArrowLeft className="size-3.5" />{t('verifier.project.back')}
  </Link>;
}
