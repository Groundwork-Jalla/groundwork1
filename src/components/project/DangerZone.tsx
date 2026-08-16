import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { archiveProject, deleteProject, restoreProject } from '@/lib/supabase/projects';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import type { ProjectRow } from '@/types/project';

// =========================================================
// Archive or delete a project. Owner only.
//
// Two actions, in the order someone should reach for them:
//
//   ARCHIVE  reversible, keeps every record, and frees a plan slot —
//            check_starter_project_limit() counts `status != 'archived'` (008).
//            This is what almost everyone actually wants: a finished house off the
//            dashboard, not erased.
//
//   DELETE   permanent, and takes the stage history, payment record, documents,
//            messages and any contractor take-off with it.
//
// The delete confirmation states the damage in figures rather than asking "are you
// sure?" about nothing in particular, and cannot be confirmed until the consequence is
// acknowledged. Nothing here is recoverable from inside the product.
// =========================================================

export default function DangerZone({
  project, stageCount, documentCount, onChanged,
}: {
  project: ProjectRow;
  stageCount: number;
  documentCount: number;
  /** Called after archive/restore so the page can refetch. */
  onChanged: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy]   = useState<'archive' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archived = project.status === 'archived';

  async function handleArchive() {
    setBusy('archive');
    setError(null);
    try {
      if (archived) await restoreProject(project.id);
      else          await archiveProject(project.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t('project.danger.errArchive')));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy('delete');
    setError(null);
    try {
      await deleteProject(project.id);
      // Straight to the list — the page we are standing on no longer exists.
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t('project.danger.errDelete')));
      setBusy(null);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-brand-border-grey p-5 dark:border-[#2c2c2c]">
      <p className="text-sm font-semibold text-brand-near-black dark:text-white">
        {t('project.danger.title')}
      </p>

      {/* ── Archive ── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-brand-off-white pb-4 dark:border-[#242424]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-brand-near-black dark:text-white">
            {archived ? t('project.danger.restoreTitle') : t('project.danger.archiveTitle')}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-mid-grey">
            {archived ? t('project.danger.restoreBody') : t('project.danger.archiveBody')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleArchive}
          disabled={busy !== null}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-border-grey px-3.5 py-2 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]"
        >
          {busy === 'archive'
            ? <Loader2 className="size-3.5 animate-spin" />
            : archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          {archived ? t('project.danger.restoreCta') : t('project.danger.archiveCta')}
        </button>
      </div>

      {/* ── Delete ── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-brand-near-black dark:text-white">
            {t('project.danger.deleteTitle')}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-mid-grey">
            {t('project.danger.deleteBody')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy !== null}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-state-alert/40 px-3.5 py-2 text-xs font-semibold text-state-alert transition-colors hover:bg-state-alert/5 disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          {t('project.danger.deleteCta')}
        </button>
      </div>

      {error && !confirming && (
        <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>
      )}

      <ConfirmDelete
        open={confirming}
        subject={project.name}
        // Counted, not hand-waved: someone deciding this needs to know what goes with it.
        consequence={t('project.danger.deleteConsequence', {
          stages: stageCount,
          documents: documentCount,
        })}
        busy={busy === 'delete'}
        error={error}
        onConfirm={handleDelete}
        onCancel={() => { setConfirming(false); setError(null); }}
      />
    </div>
  );
}
