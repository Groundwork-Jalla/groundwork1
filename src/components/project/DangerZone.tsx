import { useState } from 'react';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { archiveProject, restoreProject } from '@/lib/supabase/projects';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import type { ProjectRow } from '@/types/project';

// =========================================================
// Archive or restore a project. Owner only.
//
// ARCHIVE is reversible and keeps every record. It takes a finished house off the
// dashboard; it does NOT free a plan slot, and the copy says so.
//
// DELETE IS GONE, and not by oversight. Favour, 25 Aug 2026: "i dont want them to be
// able to delete any projects free plan or not". The free plan allows three projects
// "archived or not, deleted or not", and the cleanest way to honour the second half is
// to make the case impossible rather than to track it — a row that cannot disappear
// needs no tombstone and no counter to stay counted. See migration 053.
//
// The privilege went with the button: 053 splits `owner_all_projects` (which was FOR
// ALL) into SELECT/INSERT/UPDATE, so a DELETE against the REST endpoint is refused too.
// Removing only the button would have left the cap trivially evadable, which is the
// behaviour it exists to stop.
//
// Admins can delete, on two routes, both SECURITY DEFINER and both bypassing RLS:
// `admin_delete_user()` (035) removes an account and cascades its projects, and
// `admin_delete_project()` (069) removes a single project from /admin/projects. Neither
// is reachable by an owner, which is what keeps the paragraph above true.
// =========================================================

export default function DangerZone({
  project, onChanged,
}: {
  project: ProjectRow;
  /** Called after archive/restore so the page can refetch. */
  onChanged: () => void;
}) {
  const t = useT();

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archived = project.status === 'archived';

  async function handleArchive() {
    setBusy(true);
    setError(null);
    try {
      if (archived) await restoreProject(project.id);
      else          await archiveProject(project.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t('project.danger.errArchive')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-brand-border-grey p-5 dark:border-[#2c2c2c]">
      <p className="text-sm font-semibold text-brand-near-black dark:text-white">
        {t('project.danger.title')}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-border-grey px-3.5 py-2 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]"
        >
          {busy
            ? <Loader2 className="size-3.5 animate-spin" />
            : archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          {archived ? t('project.danger.restoreCta') : t('project.danger.archiveCta')}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>
      )}
    </div>
  );
}
