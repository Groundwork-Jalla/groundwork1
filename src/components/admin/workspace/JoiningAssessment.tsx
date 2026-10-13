import { useEffect, useState } from 'react';
import { Loader2, ClipboardCheck } from 'lucide-react';
import {
  fetchJoiningAssessments, recordJoiningAssessment,
  JOINING_CONDITIONS, type JoiningAssessment as Assessment, type JoiningCondition,
} from '@/lib/supabase/joining-assessment';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// What Jalla found in work completed before the project joined Groundwork (107).
//
// Shown ONLY on a pre-existing stage. Those stages are marked complete, cost the client
// nothing and carry no verification — the badge says "Completed outside Groundwork". That
// is honest but it is not a review, and somebody from Jalla walks the site before taking
// a half-built project on. This is where what they saw goes.
//
// Deliberately not a verification: it issues no certificate and cannot make the stage
// payable. 107's header has the full reasoning; the copy below says the same thing to
// whoever is filling it in.
// =========================================================

const CONDITION_KEY: Record<JoiningCondition, TKey> = {
  sound:           'admin.joining.sound',
  needs_attention: 'admin.joining.needs_attention',
  defective:       'admin.joining.defective',
  not_inspected:   'admin.joining.not_inspected',
};

export function JoiningAssessmentPanel({ projectId, stageId }: { projectId: string; stageId: string }) {
  const t = useT();
  const [existing, setExisting] = useState<Assessment | null>(null);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);

  const [condition, setCondition] = useState<JoiningCondition>('sound');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJoiningAssessments(projectId)
      .then(map => {
        if (!alive) return;
        const found = map.get(stageId) ?? null;
        setExisting(found);
        if (found) { setCondition(found.condition); setNotes(found.notes); }
      })
      .catch(() => { if (alive) setExisting(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, stageId]);

  async function save() {
    setError(null);
    if (notes.trim().length < 2) { setError(t('admin.joining.errNotes')); return; }
    setSaving(true);
    try {
      await recordJoiningAssessment({ stageId, condition, notes: notes.trim() });
      const map = await fetchJoiningAssessments(projectId);
      setExisting(map.get(stageId) ?? null);
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('not_permitted') ? t('admin.joining.errPermitted') : t('admin.joining.errFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" /></p>;
  }

  return (
    <div className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#111]">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <ClipboardCheck className="size-4 shrink-0" aria-hidden />{t('admin.joining.title')}
      </p>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.joining.body')}</p>

      {existing && !open ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">
            {t(CONDITION_KEY[existing.condition])}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-brand-mid-grey">{existing.notes}</p>
          <button type="button" onClick={() => setOpen(true)}
            className="mt-2 text-xs text-brand-near-black underline underline-offset-4 dark:text-white">
            {t('admin.joining.amend')}
          </button>
        </div>
      ) : !open ? (
        <div className="mt-3">
          <p className="text-xs text-brand-mid-grey">{t('admin.joining.none')}</p>
          <Button onClick={() => setOpen(true)} className="mt-2 h-8 text-xs">{t('admin.joining.record')}</Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-brand-near-black dark:text-white">{t('admin.joining.condition')}</legend>
            <div className="flex flex-wrap gap-2">
              {JOINING_CONDITIONS.map(c => (
                <label key={c}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs ${condition === c
                    ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                    : 'border-brand-border-grey text-brand-near-black dark:border-[#2c2c2c] dark:text-white'}`}>
                  <input type="radio" name="jcond" value={c} checked={condition === c}
                    onChange={() => setCondition(c)} className="sr-only" />
                  {t(CONDITION_KEY[c])}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="jnotes" className="text-xs">{t('admin.joining.notes')}</Label>
            <textarea
              id="jnotes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
            />
            <p className="text-[11px] text-brand-mid-grey">{t('admin.joining.notesHint')}</p>
          </div>

          <p className="text-[11px] text-brand-mid-grey">{t('admin.joining.notPayable')}</p>
          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving} className="h-8 text-xs">
              {saving ? t('admin.joining.saving') : t('admin.joining.save')}
            </Button>
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs text-brand-mid-grey underline underline-offset-4">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
