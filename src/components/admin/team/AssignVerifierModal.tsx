import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listVerifierOptions, assignVerifier, type VerifierOption } from '@/lib/supabase/verifiers';
import { errorMessage, isMissingTable } from '@/lib/errors';
import { useT } from '@/lib/i18n';

// Extracted from routes/admin/projects.tsx (Phase 5 step 2) so the projects list and the
// Workspace's Team tab open the same dialog. Behaviour unchanged: the rules are the
// database's — `assign_verifier()` refuses a non-admin, a user without the role, a
// contractor on this project, and a blank discipline, each with its own prefix, and this
// maps the prefix to a sentence.
export function AssignVerifierModal({ project, onClose, onAssigned, onUnavailable }: {
  project: { id: string; name: string };
  onClose: () => void;
  /** Called with the notice to show; the caller closes the dialog. */
  onAssigned: (notice: string) => void;
  /** 086 not applied yet: the caller hides the feature. */
  onUnavailable: () => void;
}) {
  const t = useT();
  const [options,    setOptions]    = useState<VerifierOption[] | null>(null);
  const [user,       setUser]       = useState('');
  const [discipline, setDiscipline] = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listVerifierOptions().then(o => { if (!cancelled) setOptions(o); }).catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; };
  }, []);

  async function handleAssign() {
    if (!user) return;
    if (!discipline.trim()) { setError(t('admin.verifier.errDiscipline')); return; }
    setBusy(true); setError(null);
    try {
      await assignVerifier(project.id, user, discipline.trim());
      const who = options?.find(o => o.userId === user);
      onAssigned(t('admin.verifier.assigned', {
        name: who?.name || who?.email || user, project: project.name, discipline: discipline.trim(),
      }));
    } catch (err) {
      if (isMissingTable(err)) { onUnavailable(); return; }
      const msg = errorMessage(err, '');
      setError(
        msg.includes('contractor_cannot_verify') ? t('admin.verifier.errContractor')
        : msg.includes('not_verifier')           ? t('admin.verifier.errNotVerifier')
        : msg.includes('discipline_required')    ? t('admin.verifier.errDiscipline')
        : msg || t('common.somethingWrong'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-sm font-bold text-brand-near-black">{t('admin.verifier.title')}</h2>
        <p className="mt-1 text-xs text-brand-mid-grey">
          {t('admin.verifier.bodyPre')}{' '}
          <span className="font-medium text-brand-near-black">{project.name}</span>{' '}
          {t('admin.verifier.bodyPost')}
        </p>

        <label htmlFor="ver-user" className="mt-4 block text-xs font-medium text-brand-near-black">
          {t('admin.verifier.who')}
        </label>
        {options === null ? (
          <p className="mt-1.5 flex items-center gap-2 text-xs text-brand-mid-grey">
            <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
          </p>
        ) : options.length === 0 ? (
          <p className="mt-1.5 text-xs text-brand-mid-grey">{t('admin.verifier.noneAvailable')}</p>
        ) : (
          <select
            id="ver-user"
            value={user}
            onChange={e => setUser(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
          >
            <option value="">{t('admin.verifier.whoPlaceholder')}</option>
            {options.map(o => (
              <option key={o.userId} value={o.userId}>{o.name ? `${o.name} — ${o.email}` : o.email}</option>
            ))}
          </select>
        )}

        <label htmlFor="ver-discipline" className="mt-3 block text-xs font-medium text-brand-near-black">
          {t('admin.verifier.discipline')}
        </label>
        <input
          id="ver-discipline"
          type="text"
          value={discipline}
          onChange={e => setDiscipline(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAssign(); }}
          placeholder={t('admin.verifier.disciplinePlaceholder')}
          className="mt-1.5 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
        />

        {error && (
          <p className="mt-2 text-xs text-state-alert" role="alert">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={busy || !user || !discipline.trim()}
            className="flex-1 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? t('admin.verifier.assigning') : t('admin.verifier.assign')}
          </button>
        </div>
      </div>
    </div>
  );
}
