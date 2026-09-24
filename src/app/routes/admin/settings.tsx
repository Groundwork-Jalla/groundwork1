import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Lock, ExternalLink } from 'lucide-react';
import { loadSettings, saveSetting, type Setting, type SettingId } from '@/lib/supabase/admin-settings';
import { errorMessage } from '@/lib/errors';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/settings — the product settings, and only those (01 §3 SYSTEM).
//
// ── Why this page is short ───────────────────────────────────────────────────────────
// `app_config` holds six keys. Two are credentials (`resend_api_key`,
// `agent_dispatch_secret`), one is internal plumbing that is only safe because the
// secret beside it is (`agent_dispatch_url`), and the GHL keys are provider
// configuration that System → Integrations already owns. That leaves three real product
// settings, and three is what this page has. A longer page would mean either exposing a
// secret or inventing a setting nothing reads.
//
// There is no generic key/value editor here, and there is deliberately no way to reach
// one: the browser sends a setting id from a list the server owns, never a config key.
// See api/_handlers/admin-settings.ts.
//
// ── Unavailable is not a default ─────────────────────────────────────────────────────
// `unanswered_conversations()` falls back to 4 hours when the row is missing. That
// fallback is the function's, not a decision anybody made, so a missing row reads here as
// "not set" with the fallback named as the fallback. Substituting it silently would
// present the code's guess as the operator's choice.
// =========================================================

const LABEL: Record<SettingId, { name: TKey; help: TKey }> = {
  notifyEmail:     { name: 'admin.settings.notifyEmail.name',     help: 'admin.settings.notifyEmail.help' },
  unansweredHours: { name: 'admin.settings.unansweredHours.name', help: 'admin.settings.unansweredHours.help' },
  unansweredBands: { name: 'admin.settings.unansweredBands.name', help: 'admin.settings.unansweredBands.help' },
};

/** Which section each setting belongs under. No section exists without a real key in it. */
const SECTIONS: { title: TKey; sub: TKey; ids: SettingId[] }[] = [
  { title: 'admin.settings.communication', sub: 'admin.settings.communicationSub', ids: ['notifyEmail'] },
  { title: 'admin.settings.actionCenter',  sub: 'admin.settings.actionCenterSub',  ids: ['unansweredHours', 'unansweredBands'] },
];

export default function AdminSettings() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]   = useState<Setting[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await loadSettings()); setError(null); }
    catch (err) { setRows(null); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('admin.settings.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.settings.subtitle')}</p>
      </header>

      {rows === undefined ? (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" />{t('common.loading')}
        </p>
      ) : rows === null ? (
        <p role="alert" className="rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-3 text-sm text-state-alert">
          {t('admin.settings.unreadable')} {error}
        </p>
      ) : (
        <div className="max-w-2xl space-y-5">
          {SECTIONS.map(section => (
            <section key={section.title} className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
                <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t(section.title)}</h2>
                <p className="mt-0.5 text-xs text-brand-mid-grey">{t(section.sub)}</p>
              </header>
              <div className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                {section.ids.map(id => {
                  const row = rows.find(r => r.id === id);
                  if (!row) return null;
                  return <Field key={id} setting={row} updated={fmt(row.updatedAt)} onSaved={setRows} />;
                })}
              </div>
            </section>
          ))}

          {/* What is in the table and is not here, said plainly rather than left to be
              discovered. A settings page that silently omits half the config invites
              somebody to go looking for the rest in the database. */}
          <section className="rounded-2xl border border-brand-border-grey bg-brand-off-white/50 px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#161616]">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-near-black dark:text-white">
              <Lock className="size-3.5" aria-hidden />{t('admin.settings.notHere')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.settings.notHereBody')}</p>
            <Link to="/admin/integrations" className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-near-black underline-offset-2 hover:underline dark:text-white">
              {t('admin.settings.toIntegrations')}<ExternalLink className="size-3.5" />
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * One setting. The value shown is always the last thing the server returned, including
 * straight after a save — a rejected value leaves the field showing what is stored, with
 * the server's reason beside it.
 */
function Field({ setting, updated, onSaved }: {
  setting: Setting;
  updated: string | null;
  onSaved: (rows: Setting[]) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(setting.value ?? '');
  const [busy, setBusy]   = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { setDraft(setting.value ?? ''); }, [setting.value]);
  const dirty = draft.trim() !== (setting.value ?? '');

  async function save() {
    setBusy(true); setProblem(null);
    try {
      onSaved(await saveSetting(setting.id, draft));
    } catch (err) {
      // The server's reason code, translated where we have a word for it. An unknown code
      // is shown as itself rather than as a generic failure.
      const code = err instanceof Error ? err.message : 'unknown';
      setProblem(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-brand-near-black dark:text-white">{t(LABEL[setting.id].name)}</p>
        {setting.editable
          ? updated && <span className="text-[11px] text-brand-mid-grey">{t('admin.settings.changed', { when: updated })}</span>
          : <span className="text-[11px] text-brand-mid-grey">{t('admin.settings.readOnly')}</span>}
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-brand-mid-grey">{t(LABEL[setting.id].help)}</p>

      {/* A missing row is "not set", and the fallback the reader would use is named as a
          fallback — not printed into the input as though somebody had chosen it. */}
      {setting.value === null && (
        <p className="mt-1.5 text-[11px] font-medium text-state-held">{t(`admin.settings.notSet.${setting.id}` as TKey)}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={busy || !setting.editable}
          inputMode={setting.type === 'hours' ? 'numeric' : 'text'}
          aria-label={t(LABEL[setting.id].name)}
          className={cn(
            'min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-xs text-brand-near-black outline-none focus:ring-2 focus:ring-brand-near-black/20 disabled:opacity-60 dark:border-[#2c2c2c] dark:bg-[#161616] dark:text-white',
            setting.type === 'bands' && 'font-mono',
          )}
        />
        {setting.type === 'hours' && <span className="shrink-0 text-[11px] text-brand-mid-grey">{t('admin.settings.unitHours')}</span>}
        {setting.editable && (
          <button
            type="button" disabled={busy || !dirty} onClick={save}
            className="shrink-0 rounded-lg bg-brand-near-black px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#0a0a0a]"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
        )}
      </div>

      {problem && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-state-alert">
          {t('admin.settings.rejected', { reason: problem })}
        </p>
      )}
    </div>
  );
}
