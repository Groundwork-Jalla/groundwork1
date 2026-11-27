import { useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { renameProject } from '@/lib/supabase/projects';
import { useLanguage, useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

interface Props {
  projectId: string;
  name: string;
  canEdit: boolean;
  headingClassName?: string;
  onRenamed: (newName: string) => void | Promise<void>;
}

/**
 * Inline project title with a discreet pencil button so owners, primary Homeowners,
 * and primary contractors can rename a project right from the header.
 */
export function ProjectNameEditor({ projectId, name, canEdit, headingClassName, onRenamed }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className={cn('min-w-0', headingClassName)}>{name}</h1>
        {canEdit && (
          <button
            type="button"
            data-action="edit-project-name"
            aria-label={lang === 'fr' ? 'Modifier le nom du projet' : 'Edit project name'}
            title={lang === 'fr' ? 'Modifier le nom du projet' : 'Edit project name'}
            onClick={() => {
              setDraft(name);
              setError(null);
              setEditing(true);
            }}
            className="shrink-0 rounded-lg p-1.5 text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#242424] dark:hover:text-white"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      setError(lang === 'fr' ? 'Entrez au moins 2 caractères.' : 'Enter at least 2 characters.');
      return;
    }
    if (trimmed === name.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await renameProject(projectId, trimmed);
      setEditing(false);
      await onRenamed(saved);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 space-y-1.5" data-edit-project-name-form>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          maxLength={120}
          disabled={saving}
          autoFocus
          aria-label={lang === 'fr' ? 'Nom du projet' : 'Project name'}
          onKeyDown={e => {
            if (e.key === 'Escape' && !saving) {
              setEditing(false);
              setError(null);
            }
          }}
          onChange={e => {
            setDraft(e.target.value);
            setError(null);
          }}
          className="min-h-10 min-w-[200px] flex-1 rounded-xl border border-brand-green/60 bg-white px-3 py-1.5 text-lg font-bold text-brand-near-black outline-none focus:border-brand-green dark:border-[#3a3a3a] dark:bg-[#1e1e1e] dark:text-white"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            disabled={saving || draft.trim().length < 2}
            data-action="save-project-name"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-green px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-green-hover disabled:opacity-45"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {lang === 'fr' ? 'Enregistrer' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => { setEditing(false); setError(null); }}
            aria-label={t('common.cancel')}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-brand-border-grey bg-white px-2.5 py-2 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
    </form>
  );
}
