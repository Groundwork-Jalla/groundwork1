import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Loader2, ArrowLeft, Download, ExternalLink, CloudOff, AlertTriangle, Check, Mail,
} from 'lucide-react';
import {
  getApplication, setApplicationStatus, signCredentialUrl, promoteApplication,
  sendDecisionEmail,
  sendAcknowledgement,
  ASSIGNABLE_STATUSES, type ApplicationDetail,
} from '@/lib/supabase/admin-applications';
import { StatusPill, useRoleLabel, fmtDate } from './applications';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/applications/:id
//
// This exact path is what api/ghl/contractor.ts writes into every CRM record as
// `application_url`. Renaming it silently breaks every link already sitting in
// GoHighLevel, so the route is fixed even though the file lives elsewhere.
//
// GHL holds a lead summary only. Everything the CRM deliberately does not carry —
// the repeatable project history, client references, and the uploaded credentials —
// is what this page exists to show.
// =========================================================

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{label}</dt>
      <dd className="mt-0.5 text-sm text-brand-near-black">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-brand-border-grey bg-white">
      <h2 className="border-b border-brand-off-white px-5 py-3 text-sm font-semibold text-brand-near-black">
        {title}
      </h2>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{children}</dl>;
}

/** External links are user-supplied — never send the referrer or hand over `window.opener`. */
function Ext({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow"
       className="inline-flex items-center gap-1 text-brand-near-black underline underline-offset-2 hover:opacity-70">
      {href} <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * The bucket is private, so a stored path is not openable. Sign on click rather than
 * on render: signing every file up front would mint links for documents nobody opens,
 * and each one stays valid for an hour.
 */
function CredentialRow({ label, path, size }: { label: string; path: string; size: number }) {
  const t = useT();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(false);

  async function open() {
    setBusy(true); setError(false);
    const url = await signCredentialUrl(path);
    setBusy(false);
    if (!url) { setError(true); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-brand-off-white py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-brand-near-black">{label || path.split('/').pop()}</p>
        <p className="text-xs text-brand-mid-grey tabular-nums">
          {size > 0 ? `${(size / 1024).toFixed(0)} KB` : '—'}
          {error && <span className="ml-2 text-state-alert">{t('admin.apps.signFailed')}</span>}
        </p>
      </div>
      <button
        type="button" onClick={open} disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {busy ? t('admin.apps.signing') : t('admin.apps.download')}
      </button>
    </div>
  );
}

export default function AdminApplicationDetail() {
  const t = useT();
  const { lang } = useLanguage();
  const roleLabel = useRoleLabel();
  const { id } = useParams<{ id: string }>();

  const [app, setApp]         = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [sendingAck, setSendingAck] = useState(false);
  const [notice, setNotice]   = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getApplication(id)
      .then(a => { if (alive) setApp(a); })
      .catch(() => { if (alive) setApp(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  /**
   * Accepting also publishes them to the public directory. Until now it only moved a
   * status column, so an accepted contractor appeared nowhere and the directory stayed
   * empty. The publish is idempotent, so re-accepting refreshes the entry rather than
   * creating a second one.
   *
   * The status is saved first and kept even if publishing fails: the decision is the
   * admin's and should not be lost to a directory problem, which is recoverable by
   * pressing Accept again.
   */
  async function decide(status: typeof ASSIGNABLE_STATUSES[number]) {
    if (!id) return;
    setSaving(true); setNotice(null);
    try {
      await setApplicationStatus(id, status);
      setApp(prev => (prev ? { ...prev, status } : prev));

      if (status === 'accepted') {
        try {
          await promoteApplication(id);
          setNotice({ ok: true, text: t('admin.apps.publishedToDirectory') });
        } catch {
          setNotice({ ok: false, text: t('admin.apps.publishFailed') });
        }
      } else {
        setNotice({ ok: true, text: t('admin.apps.statusSaved') });
      }

      // Tell the applicant. Reported separately from the decision itself: the status is
      // already saved, so a mail failure must not read as "the decision did not stick".
      // `reviewing` is an internal state and never generates a message.
      if (status === 'accepted' || status === 'rejected') {
        try {
          await sendDecisionEmail(id, status);
          setNotice(prev => ({
            ok: prev?.ok ?? true,
            text: `${prev?.text ?? ''} ${t('admin.apps.applicantNotified')}`.trim(),
          }));
        } catch {
          setNotice(prev => ({
            ok: false,
            text: `${prev?.text ?? ''} ${t('admin.apps.notifyFailed')}`.trim(),
          }));
        }
      }
    } catch {
      setNotice({ ok: false, text: t('admin.apps.statusFailed') });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Send the "we received your application" email by hand.
   *
   * Separate from decide(): this is not a decision, it is the acknowledgement the
   * applicant should have got at submission and didn't while the notify endpoint was
   * crashing. Kept available even once sent, because a bounced or lost email is a real
   * reason to send a second one — the timestamp below is what stops that being blind.
   */
  async function acknowledge() {
    if (!id) return;
    setSendingAck(true); setNotice(null);
    try {
      const sentAt = await sendAcknowledgement(id);
      setApp(prev => (prev ? { ...prev, acknowledgedAt: sentAt } : prev));
      setNotice({ ok: true, text: t('admin.apps.ackSent') });
    } catch {
      setNotice({ ok: false, text: t('admin.apps.ackFailed') });
    } finally {
      setSendingAck(false);
    }
  }

  const yn = (v: boolean) => (v ? t('admin.apps.yes') : t('admin.apps.no'));

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-8 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  if (!app) {
    return (
      <div className="p-8">
        <BackLink />
        <p className="mt-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {t('admin.apps.notFound')}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <BackLink />

      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black">{app.fullName}</h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            {app.businessName ? `${app.businessName} · ` : ''}{app.city}, {app.country}
          </p>
          <div className="mt-2"><StatusPill status={app.status} /></div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
            {t('admin.apps.setStatus')}
          </p>
          <div className="flex gap-2">
            {ASSIGNABLE_STATUSES.map(s => (
              <button
                key={s} type="button" disabled={saving || app.status === s}
                onClick={() => decide(s)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
                  app.status === s
                    ? 'border-brand-near-black bg-brand-near-black text-white'
                    : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white',
                )}
              >
                {t(`admin.apps.mark${s.charAt(0).toUpperCase()}${s.slice(1)}` as TKey)}
              </button>
            ))}
          </div>

          {/* The acknowledgement is normally automatic. This is the manual send for the
              applicants it never reached, and the timestamp is how you tell them apart —
              "never" is the backlog, a date is done. */}
          <div className="mt-3 flex flex-col items-end gap-1">
            <button
              type="button" disabled={sendingAck}
              onClick={acknowledge}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
            >
              {sendingAck
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Mail className="size-3.5" />}
              {app.acknowledgedAt ? t('admin.apps.ackResend') : t('admin.apps.ackSend')}
            </button>
            <p className={cn('text-[11px]', app.acknowledgedAt ? 'text-brand-mid-grey' : 'text-state-held')}>
              {app.acknowledgedAt
                ? t('admin.apps.ackLastSent', { date: fmtDate(app.acknowledgedAt, lang) })
                : t('admin.apps.ackNever')}
            </p>
          </div>
        </div>
      </header>

      {notice && (
        <p role="status"
           className={cn('mb-4 rounded-xl border px-4 py-2.5 text-sm',
             notice.ok
               ? 'border-state-complete/30 text-state-complete'
               : 'border-state-alert/30 text-state-alert')}>
          {notice.text}
        </p>
      )}

      {app.status === 'disqualified' && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-state-held" />
          {t('admin.apps.disqualifiedNote')}
        </p>
      )}

      {!app.syncedToGhl && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-mid-grey">
          <CloudOff className="mt-0.5 size-4 shrink-0" />
          {t('admin.apps.crmPending')}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <Section title={t('admin.apps.sBasic')}>
          <Grid>
            <Field label={t('admin.apps.fEmail')}    value={<a className="underline underline-offset-2" href={`mailto:${app.email}`}>{app.email}</a>} />
            <Field label={t('admin.apps.fPhone')}    value={<a className="underline underline-offset-2" href={`tel:${app.phone}`}>{app.phone}</a>} />
            <Field label={t('admin.apps.fBusiness')} value={app.businessName} />
            <Field label={t('admin.apps.fLocation')} value={`${app.city}, ${app.country}`} />
            <Field label={t('admin.apps.fPortfolio')} value={app.portfolioUrl ? <Ext href={app.portfolioUrl} /> : null} />
            <Field label={t('admin.apps.fSubmittedIn')} value={app.lang.toUpperCase()} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sCategory')}>
          <Grid>
            <Field label={t('admin.apps.fRole')}      value={roleLabel(app.role)} />
            <Field label={t('admin.apps.fRoleOther')} value={app.roleOther} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sExperience')}>
          <Grid>
            <Field label={t('admin.apps.fYears')}     value={app.yearsExperience} />
            <Field label={t('admin.apps.fOperatesAs')} value={app.operatesAs} />
            <Field label={t('admin.apps.fTeamSize')}  value={app.teamSize} />
            <Field label={t('admin.apps.fProjectTypes')}
                   value={app.projectTypes.length ? app.projectTypes.join(', ') : null} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sCredentials')}>
          {Object.keys(app.credentials).length > 0 && (
            <Grid>
              {Object.entries(app.credentials).map(([k, v]) => (
                <Field key={k} label={k.replace(/_/g, ' ')}
                       value={typeof v === 'boolean' ? yn(v) : String(v ?? '')} />
              ))}
            </Grid>
          )}
          <div className="mt-2">
            {app.uploads.length === 0
              ? <p className="py-2 text-sm text-brand-mid-grey">{t('admin.apps.noUploads')}</p>
              : app.uploads.map(u => (
                  <CredentialRow key={u.path} label={u.label} path={u.path} size={u.size} />
                ))}
          </div>
        </Section>

        <Section title={t('admin.apps.sHistory')}>
          {app.projects.length === 0 ? (
            <p className="py-2 text-sm text-brand-mid-grey">{t('admin.apps.noProjects')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {app.projects.map((p, i) => (
                <div key={`${p.name}-${i}`} className="rounded-lg border border-brand-border-grey px-4 py-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                    {t('admin.apps.project', { n: i + 1 })}
                  </p>
                  <p className="text-sm font-medium text-brand-near-black">{p.name}</p>
                  <p className="text-xs text-brand-mid-grey">
                    {[p.location, p.budget, p.role, p.year].filter(Boolean).join(' · ')}
                  </p>
                  {(p.refName || p.refPhone || p.refEmail) && (
                    <p className="mt-2 text-xs text-brand-mid-grey">
                      <span className="font-semibold">{t('admin.apps.reference')}:</span>{' '}
                      {[p.refName, p.refPhone, p.refEmail].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('admin.apps.sStandards')}>
          <Grid>
            <Field label={t('admin.apps.fMilestones')}   value={yn(app.acceptsMilestones)} />
            <Field label={t('admin.apps.fVerification')} value={yn(app.acceptsVerification)} />
            <Field label={t('admin.apps.fNoSidePay')}    value={yn(app.acceptsNoSidePay)} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sAlignment')}>
          <Field label={t('admin.apps.fWhyJoin')}    value={<span className="whitespace-pre-wrap">{app.whyJoin}</span>} />
          <Field label={t('admin.apps.fDifferent')}  value={<span className="whitespace-pre-wrap">{app.differentiator}</span>} />
          <Grid>
            <Field label={t('admin.apps.fReadyEarly')} value={yn(app.readyForEarly)} />
            <Field label={t('admin.apps.fVideo')}      value={app.videoUrl ? <Ext href={app.videoUrl} /> : null} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sCapacity')}>
          <Grid>
            <Field label={t('admin.apps.fRegions')}    value={app.regions} />
            <Field label={t('admin.apps.fConcurrent')} value={app.concurrentProjects} />
          </Grid>
        </Section>

        <Section title={t('admin.apps.sAgreement')}>
          <p className="flex items-center gap-2 py-1 text-sm text-brand-near-black">
            {app.agreedToTerms && <Check className="size-4 text-state-complete" />}
            {t('admin.apps.fTerms')}: {yn(app.agreedToTerms)}
          </p>
        </Section>
      </div>
    </div>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/admin/applications"
          className="inline-flex items-center gap-1.5 text-sm text-brand-mid-grey transition-colors hover:text-brand-near-black">
      <ArrowLeft className="size-3.5" /> {t('admin.apps.back')}
    </Link>
  );
}
