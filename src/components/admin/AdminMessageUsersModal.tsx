import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, Mail, Send, X } from 'lucide-react';
import type { AdminUser } from '@/lib/supabase/admin-users';
import type { Lang } from '@/lib/i18n/types';
import {
  AdminMessageUsersError,
  sendAdminUsersMessage,
  type AdminMessageUsersResult,
} from '@/lib/supabase/admin-message-users';
import { adminBroadcastHtml } from '@/lib/email/admin-broadcast-html';

interface Props {
  open: boolean;
  recipients: AdminUser[];
  onClose: () => void;
  onSent: (result: AdminMessageUsersResult) => void;
}

const ACTION_PRESETS = [
  { path: '/projects/new', labelEn: 'Start or activate a project', labelFr: 'Créer ou activer un projet' },
  { path: '/dashboard', labelEn: 'Open dashboard', labelFr: 'Ouvrir le tableau de bord' },
  { path: '/work/partner', labelEn: 'Apply to Partner Network', labelFr: 'Rejoindre le réseau partenaire' },
] as const;

const STARTER_TEMPLATES = {
  nudge_en: {
    lang: 'en' as Lang,
    subject: 'Ready to start your first project on Groundwork?',
    message:
      'You signed up on Groundwork by Jalla, and your workspace is ready whenever you are.\n\n'
      + 'Did you know you can upload your building plan or Bill of Quantities, track every construction stage with photo proof, and keep all receipts in one place — for free?\n\n'
      + 'Click below to set up your first project in just a few minutes. If you need any help getting started, simply reply or reach out to our team.',
    actionLabel: 'Activate your project',
    actionPath: '/projects/new',
  },
  nudge_fr: {
    lang: 'fr' as Lang,
    subject: 'Prêt(e) à activer votre premier projet sur Groundwork ?',
    message:
      'Vous avez créé votre compte sur Groundwork by Jalla, et votre espace est prêt.\n\n'
      + 'Saviez-vous que vous pouvez importer votre plan ou devis estimatif, suivre chaque étape du chantier avec des preuves photo et centraliser tous vos reçus — gratuitement ?\n\n'
      + 'Cliquez ci-dessous pour lancer ou activer votre projet en quelques minutes. Notre équipe reste disponible si vous avez besoin d’accompagnement.',
    actionLabel: 'Activer mon projet',
    actionPath: '/projects/new',
  },
} as const;

function friendlyError(err: unknown): string {
  if (err instanceof AdminMessageUsersError) {
    switch (err.code) {
      case 'not_signed_in': return 'Your session expired. Sign in again and retry.';
      case 'forbidden': return 'Only administrators can message users.';
      case 'recipients_required': return 'Select at least one user to message.';
      case 'subject_required': return 'Enter an email subject before sending.';
      case 'message_required': return 'Write your message before sending.';
      case 'invalid_action_url': return 'Button link must start with "/" (e.g. /projects/new) or "https://".';
      case 'no_valid_recipients': return 'None of the selected accounts have a valid email address.';
      default: return 'Could not send emails right now. Please retry.';
    }
  }
  return 'Could not send emails right now. Please retry.';
}

export function AdminMessageUsersModal({ open, recipients, onClose, onSent }: Props) {
  const [lang, setLang] = useState<Lang>('en');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeActionLink, setIncludeActionLink] = useState(true);
  const [actionLabel, setActionLabel] = useState('Activate your project');
  const [actionPath, setActionPath] = useState('/projects/new');
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminMessageUsersResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setShowPreview(false);
  }, [open]);

  const withProjectsCount = useMemo(
    () => recipients.filter(u => u.projectCount > 0).length,
    [recipients],
  );
  const withoutProjectsCount = recipients.length - withProjectsCount;

  const sampleRecipient = recipients[0];
  const previewHtml = useMemo(() => {
    if (!showPreview) return '';
    return adminBroadcastHtml({
      recipientName: sampleRecipient?.fullName || 'Sample User',
      body: message.trim() || (lang === 'fr' ? 'Votre message apparaîtra ici…' : 'Your message will appear here…'),
      lang,
      actionLabel: includeActionLink ? actionLabel : null,
      actionPath: includeActionLink ? actionPath : null,
    });
  }, [showPreview, sampleRecipient, message, lang, includeActionLink, actionLabel, actionPath]);

  if (!open) return null;

  function applyTemplate(key: keyof typeof STARTER_TEMPLATES) {
    const tpl = STARTER_TEMPLATES[key];
    setLang(tpl.lang);
    setSubject(tpl.subject);
    setMessage(tpl.message);
    setIncludeActionLink(true);
    setActionLabel(tpl.actionLabel);
    setActionPath(tpl.actionPath);
    setError(null);
  }

  function clearDraft() {
    setSubject('');
    setMessage('');
    setError(null);
  }

  function switchLang(next: Lang) {
    setLang(next);
    if (actionLabel === 'Activate your project' && next === 'fr') {
      setActionLabel('Activer mon projet');
    } else if (actionLabel === 'Activer mon projet' && next === 'en') {
      setActionLabel('Activate your project');
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (busy || recipients.length === 0) return;

    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (cleanSubject.length < 2) {
      setError('Enter an email subject before sending.');
      return;
    }
    if (cleanMessage.length < 2) {
      setError('Write your message before sending.');
      return;
    }

    const confirmed = window.confirm(
      `Send "${cleanSubject}" to ${recipients.length} user${recipients.length === 1 ? '' : 's'} now?`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await sendAdminUsersMessage({
        userIds: recipients.map(u => u.id),
        subject: cleanSubject,
        message: cleanMessage,
        lang,
        includeActionLink,
        actionLabel: includeActionLink ? actionLabel.trim() : undefined,
        actionPath: includeActionLink ? actionPath.trim() : undefined,
      });
      setResult(res);
      onSent(res);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-message-users-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-brand-border-grey bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-brand-border-grey bg-brand-off-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-green text-white">
              <Mail className="size-4" />
            </span>
            <div>
              <h2 id="admin-message-users-title" className="text-base font-bold text-brand-near-black">
                Message Selected Users
              </h2>
              <p className="text-xs text-brand-mid-grey">
                Sending branded Groundwork email to{' '}
                <strong className="text-brand-near-black">{recipients.length}</strong>{' '}
                user{recipients.length === 1 ? '' : 's'}
                {withoutProjectsCount > 0 && ` · ${withoutProjectsCount} without projects`}
                {withProjectsCount > 0 && ` · ${withProjectsCount} with projects`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-white hover:text-brand-near-black disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSend} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Recipient preview strip */}
          <div className="rounded-xl border border-brand-border-grey bg-brand-off-white/60 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {recipients.slice(0, 6).map(u => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 rounded-full border border-brand-border-grey bg-white px-2.5 py-0.5 text-[11px] font-medium text-brand-near-black"
                >
                  <span className="max-w-[160px] truncate">{u.fullName || u.email}</span>
                  <span className="text-[10px] text-brand-mid-grey">({u.projectCount})</span>
                </span>
              ))}
              {recipients.length > 6 && (
                <span className="text-xs font-semibold text-brand-mid-grey">
                  +{recipients.length - 6} more
                </span>
              )}
            </div>
            {withProjectsCount > 0 && withoutProjectsCount > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800">
                <AlertTriangle className="size-3.5 shrink-0" />
                {withProjectsCount} selected user{withProjectsCount === 1 ? ' already has' : 's already have'} a project.
              </p>
            )}
          </div>

          {/* Starter templates + Language */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                Quick fill:
              </span>
              <button
                type="button"
                onClick={() => applyTemplate('nudge_en')}
                className="rounded-lg border border-brand-border-grey bg-white px-2.5 py-1 text-xs font-medium text-brand-near-black hover:bg-brand-off-white"
              >
                Activation Nudge (EN)
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('nudge_fr')}
                className="rounded-lg border border-brand-border-grey bg-white px-2.5 py-1 text-xs font-medium text-brand-near-black hover:bg-brand-off-white"
              >
                Relance projet (FR)
              </button>
              {(subject || message) && (
                <button
                  type="button"
                  onClick={clearDraft}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="inline-flex rounded-lg border border-brand-border-grey bg-brand-off-white p-0.5 text-xs font-semibold">
              {(['en', 'fr'] as const).map(code => (
                <button
                  key={code}
                  type="button"
                  onClick={() => switchLang(code)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    lang === code
                      ? 'bg-brand-green text-white'
                      : 'text-brand-mid-grey hover:text-brand-near-black'
                  }`}
                >
                  {code === 'en' ? 'English' : 'Français'}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label htmlFor="admin-msg-subject" className="mb-1 block text-xs font-semibold text-brand-near-black">
              Email Subject
            </label>
            <input
              id="admin-msg-subject"
              type="text"
              maxLength={160}
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={lang === 'fr' ? 'Ex: Prêt(e) à activer votre projet ?' : 'e.g. Ready to activate your project?'}
              className="w-full rounded-xl border border-brand-border-grey bg-white px-3.5 py-2 text-sm text-brand-near-black outline-none focus:ring-2 focus:ring-brand-green/25"
              required
            />
          </div>

          {/* Message Body */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="admin-msg-body" className="text-xs font-semibold text-brand-near-black">
                Message
              </label>
              <span className="text-[11px] text-brand-mid-grey">
                Greeting ({lang === 'fr' ? 'Bonjour Prénom,' : 'Hi FirstName,'}) is added automatically · optional{' '}
                <code className="rounded bg-brand-off-white px-1 py-0.5">{'{{name}}'}</code>
              </span>
            </div>
            <textarea
              id="admin-msg-body"
              rows={6}
              maxLength={8000}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={
                lang === 'fr'
                  ? 'Écrivez votre message ici. Séparez les paragraphes par une ligne vide…'
                  : 'Type your message here. Separate paragraphs with a blank line…'
              }
              className="w-full rounded-xl border border-brand-border-grey bg-white px-3.5 py-2.5 text-sm leading-relaxed text-brand-near-black outline-none focus:ring-2 focus:ring-brand-green/25"
              required
            />
          </div>

          {/* Optional Action Link */}
          <div className="rounded-xl border border-brand-border-grey bg-brand-off-white/40 p-3.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-brand-near-black">
              <input
                type="checkbox"
                checked={includeActionLink}
                onChange={e => setIncludeActionLink(e.target.checked)}
                className="size-4 rounded border-brand-border-grey accent-brand-green"
              />
              Include call-to-action button (links straight to Groundwork)
            </label>

            {includeActionLink && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="admin-msg-cta-label" className="mb-1 block text-[11px] font-medium text-brand-mid-grey">
                    Button Text
                  </label>
                  <input
                    id="admin-msg-cta-label"
                    type="text"
                    maxLength={80}
                    value={actionLabel}
                    onChange={e => setActionLabel(e.target.value)}
                    placeholder={lang === 'fr' ? 'Activer mon projet' : 'Activate your project'}
                    className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-xs text-brand-near-black outline-none focus:ring-2 focus:ring-brand-green/25"
                  />
                </div>
                <div>
                  <label htmlFor="admin-msg-cta-path" className="mb-1 block text-[11px] font-medium text-brand-mid-grey">
                    Destination Link
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="admin-msg-cta-path"
                      type="text"
                      maxLength={300}
                      value={actionPath}
                      onChange={e => setActionPath(e.target.value)}
                      placeholder="/projects/new"
                      className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-xs text-brand-near-black outline-none focus:ring-2 focus:ring-brand-green/25"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ACTION_PRESETS.map(p => (
                      <button
                        key={p.path}
                        type="button"
                        onClick={() => {
                          setActionPath(p.path);
                          setActionLabel(lang === 'fr' ? p.labelFr : p.labelEn);
                        }}
                        className="rounded border border-brand-border-grey bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-mid-grey hover:text-brand-near-black"
                      >
                        {p.path}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Preview toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowPreview(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline"
            >
              <Eye className="size-3.5" />
              {showPreview ? 'Hide email preview' : 'Preview branded email'}
            </button>
            {showPreview && (
              <div className="mt-2 overflow-hidden rounded-xl border border-brand-border-grey bg-[#f5f5f5]">
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  sandbox=""
                  className="h-80 w-full border-0 bg-[#f5f5f5]"
                />
              </div>
            )}
          </div>

          {/* Error or Result */}
          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          {result && (
            <div
              role="status"
              className={`rounded-xl border px-3.5 py-3 text-xs ${
                result.failed === 0
                  ? 'border-state-complete/30 bg-emerald-50/70 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <p className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="size-4 shrink-0" />
                Sent to {result.sent} user{result.sent === 1 ? '' : 's'}
                {result.failed > 0 ? ` · ${result.failed} failed` : ''}
                {result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}
              </p>
              {result.failures.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px]">
                  {result.failures.map((f, i) => (
                    <li key={`${f.email}-${i}`}>
                      <span className="font-mono">{f.email}</span> — {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2 border-t border-brand-border-grey pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-brand-border-grey bg-white px-4 py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white disabled:opacity-40"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={busy || recipients.length === 0 || !subject.trim() || !message.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-green/90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {busy
                ? `Sending to ${recipients.length}…`
                : `Send to ${recipients.length} user${recipients.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
