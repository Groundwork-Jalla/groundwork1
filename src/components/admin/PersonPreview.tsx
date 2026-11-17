import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExternalLink, Loader2, Phone, UserRound, X } from 'lucide-react';
import {
  fetchPersonRecord, parsePersonParam, personParam,
  type PersonRecord, type PersonRef,
} from '@/lib/supabase/admin-person';
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon';
import { useDomainLabels } from '@/lib/domain-labels';
import { useT, type TKey } from '@/lib/i18n';
import { formatDate, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

// =========================================================
// The person behind a name, without leaving the list.
//
// One panel, opened from Users, Clients and Contractors alike. It is a panel over the
// list and not a page of its own for the same reason the contractor profile is: the
// decision is made in the list, and a separate page loses your place.
//
// ── Only what exists ───────────────────────────────────────────────────────────────
// A section appears when the person has data in it and not otherwise. An account
// without onboarding is a client, not a contractor with blanks; a listing without an
// account is said to be that. No placeholder rows, no sample values — the admin shows
// real Supabase data or an honest empty state, and a label beside a dash is the first
// thing a reader learns to skip.
//
// ── Deep-linked, so Back closes it ─────────────────────────────────────────────────
// The open person is in `?person=`, which means global search can land directly on
// one, a URL can be pasted to a colleague, and the browser's Back button closes the
// panel instead of leaving the page. An email-only reference (a directory listing with
// no application) opens in memory instead — see personParam.
// =========================================================

/**
 * Which person is open, from the URL or from a click.
 *
 * Returns the current reference and two setters. `open` writes the URL when the
 * reference can be expressed there and falls back to state when it cannot; `close`
 * clears both.
 */
export function usePersonPreview(): {
  ref: PersonRef | null;
  rolesHint: string | null;
  open: (ref: PersonRef, rolesHint?: string | null) => void;
  close: () => void;
} {
  const [params, setParams] = useSearchParams();
  const [local, setLocal] = useState<PersonRef | null>(null);
  const [rolesHint, setRolesHint] = useState<string | null>(null);

  const fromUrl = parsePersonParam(params.get('person'));
  const ref = fromUrl ?? local;

  const open = useCallback((next: PersonRef, hint?: string | null) => {
    setRolesHint(hint ?? null);
    const value = personParam(next);
    if (value) {
      const p = new URLSearchParams(params);
      p.set('person', value);
      setParams(p);
      setLocal(null);
    } else {
      setLocal(next);
    }
  }, [params, setParams]);

  const close = useCallback(() => {
    setLocal(null);
    setRolesHint(null);
    if (params.has('person')) {
      const p = new URLSearchParams(params);
      p.delete('person');
      setParams(p);
    }
  }, [params, setParams]);

  return { ref, rolesHint, open, close };
}

export function PersonPreview({ reference, rolesHint, onClose }: {
  reference: PersonRef | null;
  rolesHint?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const labels = useDomainLabels();
  const [record, setRecord] = useState<PersonRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reference) { setRecord(null); setError(null); return; }
    let alive = true;
    setLoading(true); setError(null); setRecord(null);
    fetchPersonRecord(reference, rolesHint)
      .then(r => { if (alive) setRecord(r); })
      .catch(err => { if (alive) setError(errorMessage(err, t('admin.person.loadFailed'))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reference, rolesHint, t]);

  // Escape closes, like every other admin dialog.
  useEffect(() => {
    if (!reference) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reference, onClose]);

  if (!reference) return null;

  const a = record?.account ?? null;
  const name = a?.fullName || record?.application?.email || a?.email || t('admin.person.unknown');
  const phone = a?.phone ?? record?.application?.phone ?? null;
  const waDigits = phone ? phone.replace(/[^\d]/g, '') : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <aside
        role="dialog" aria-modal="true" aria-label={name}
        onClick={e => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-brand-border-grey bg-white shadow-xl dark:border-[#2c2c2c] dark:bg-[#1a1a1a]"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-brand-border-grey bg-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
              {t('admin.person.title')}
            </p>
            <h2 className="mt-0.5 truncate text-base font-bold text-brand-near-black dark:text-white">{name}</h2>
            {a && a.roles.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1">
                {a.roles.map(r => (
                  <span key={r} className="rounded-full bg-brand-off-white px-2 py-0.5 text-[10px] font-semibold uppercase text-brand-near-black dark:bg-[#282828] dark:text-white">
                    {r}
                  </span>
                ))}
              </p>
            )}
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('common.close')}
            className="-m-1 shrink-0 rounded-lg p-1 text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 px-5 py-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-brand-mid-grey">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
              {error}
            </p>
          )}

          {record && !a && !record.application && (
            <p className="rounded-xl border border-dashed border-brand-border-grey px-4 py-6 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
              {t('admin.person.noAccount')}
            </p>
          )}

          {record && (a || record.application) && (
            <div className="space-y-5">
              {/* ── Contact: the two things an admin reaches for first ── */}
              <Section title={t('admin.person.contact')}>
                <Row label={t('admin.person.email')} value={a?.email ?? record.application?.email ?? null} mono />
                <Row label={t('admin.person.phone')} value={phone} mono
                  trailing={phone && waDigits ? (
                    <span className="flex items-center gap-1.5">
                      <a href={`tel:${phone}`} aria-label={t('admin.person.call')}
                        className="rounded-md p-1 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
                        <Phone className="size-3.5" aria-hidden />
                      </a>
                      <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer"
                        aria-label={t('admin.person.whatsapp')}
                        className="rounded-md p-1 text-[#25D366] hover:opacity-80">
                        <WhatsAppIcon className="size-3.5" />
                      </a>
                    </span>
                  ) : null} />
                {a && <Row label={t('admin.person.language')}
                  value={a.preferredLang ? t(`admin.person.lang.${a.preferredLang}` as TKey) : t('admin.person.langNotChosen')} />}
              </Section>

              {/* ── Account: what signup recorded ── */}
              {a && (
                <Section title={t('admin.person.account')}>
                  <Row label={t('admin.person.signupCountry')} value={a.signupCountry} />
                  <Row label={t('admin.person.joined')} value={`${formatDate(a.createdAt)} · ${formatRelative(a.createdAt)}`} />
                  {a.tier && <Row label={t('admin.person.plan')} value={labels.tier(a.tier)} />}
                  {a.provisionedBy && <Row label={t('admin.person.provisioned')} value={t('admin.person.provisionedBy')} />}
                  {a.mustChangePassword && <Row label={t('admin.person.password')} value={t('admin.person.temporaryPassword')} />}
                  <Row label={t('admin.person.crm')}
                    value={a.syncedToCrm ? t('admin.person.crmSynced') : t('admin.person.crmNotSynced')}
                    trailing={a.ghlContactId ? <span className="font-mono text-[10px] text-brand-mid-grey">{a.ghlContactId}</span> : null} />
                  <Row label={t('admin.person.userId')} value={a.id} mono />
                </Section>
              )}

              {/* ── Onboarding: a contractor's own details ── */}
              {record.onboarding && (
                <Section title={t('admin.person.onboarding')}>
                  <Row label={t('admin.person.dateOfBirth')} value={record.onboarding.dateOfBirth ? formatDate(record.onboarding.dateOfBirth) : null} />
                  <Row label={t('admin.person.address')} value={record.onboarding.address} />
                  <Row label={t('admin.person.specialty')}
                    value={[record.onboarding.specialty ? labels.trade(record.onboarding.specialty) : null, record.onboarding.specialtyOther].filter(Boolean).join(' · ') || null} />
                  <Row label={t('admin.person.license')} value={record.onboarding.licenseNumber} mono />
                  <Row label={t('admin.person.business')}
                    value={[record.onboarding.businessStatus, record.onboarding.businessName, record.onboarding.businessRegNumber].filter(Boolean).join(' · ') || null} />
                  <Row label={t('admin.person.clientIntent')} value={record.onboarding.clientIntent} />
                  <Row label={t('admin.person.partnerInterest')} value={record.onboarding.partnerInterest} />
                  {record.onboarding.emergencyContacts.length > 0 && (
                    <Row label={t('admin.person.emergencyContacts')}
                      value={record.onboarding.emergencyContacts.map(c => [c.fullName, c.relationship, c.phone].filter(Boolean).join(' · ')).join('\n')} />
                  )}
                  {record.onboarding.documents.length > 0 && (
                    <Row label={t('admin.person.documents')}
                      value={record.onboarding.documents.map(d => `${d.kind}: ${d.filename}`).join('\n')} />
                  )}
                </Section>
              )}

              {/* ── Application: the form they filled, linked to its full page ── */}
              {record.application && (
                <Section title={t('admin.person.application')}
                  action={
                    <Link to={`/admin/applications/${record.application.id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-near-black underline underline-offset-2 dark:text-white">
                      {t('admin.person.openApplication')} <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  }>
                  <Row label={t('admin.person.appStatus')} value={record.application.status} />
                  <Row label={t('admin.person.appRole')}
                    value={[record.application.role ? labels.trade(record.application.role) : null, record.application.roleOther].filter(Boolean).join(' · ') || null} />
                  <Row label={t('admin.person.appExperience')}
                    value={record.application.yearsExperience != null ? t('admin.dir.yearsValue', { years: record.application.yearsExperience }) : null} />
                  <Row label={t('admin.person.appOperatesAs')} value={record.application.operatesAs} />
                  <Row label={t('admin.person.appBusiness')} value={record.application.businessName} />
                  <Row label={t('admin.person.appLocation')} value={[record.application.city, record.application.country].filter(Boolean).join(', ') || null} />
                  <Row label={t('admin.person.appRegions')} value={record.application.regions} />
                  <Row label={t('admin.person.appTeam')} value={record.application.teamSize} />
                  <Row label={t('admin.person.appApplied')} value={formatDate(record.application.createdAt)} />
                </Section>
              )}

              {/* ── Projects: what they have started ── */}
              {a && (
                <Section title={t('admin.person.projects')}>
                  {record.projects.length === 0 ? (
                    <p className="text-xs text-brand-mid-grey">{t('admin.clients.noProjects')}</p>
                  ) : (
                    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                      {record.projects.map(p => (
                        <li key={p.id}>
                          <Link to={`/admin/projects/${p.id}`} className="flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:text-brand-near-black dark:hover:text-white">
                            <span className="min-w-0 truncate font-medium text-brand-near-black dark:text-white">{p.name}</span>
                            <span className="shrink-0 text-brand-mid-grey">
                              {[p.tier ? labels.tier(p.tier) : null, p.currentStage != null ? t('admin.person.stageN', { n: p.currentStage }) : null, p.city ?? p.country]
                                .filter(Boolean).join(' · ')}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
          <UserRound className="size-3" aria-hidden />{title}
        </h3>
        {action}
      </div>
      <dl className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c]">{children}</dl>
    </section>
  );
}

/** A labelled value. Renders nothing when there is no value — see the header. */
function Row({ label, value, mono, trailing }: {
  label: string; value: string | null | undefined; mono?: boolean; trailing?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-brand-border-grey px-3 py-2 last:border-b-0 dark:border-[#2c2c2c]">
      <dt className="shrink-0 text-[11px] text-brand-mid-grey">{label}</dt>
      <dd className={cn('min-w-0 flex-1 whitespace-pre-line break-words text-right text-xs text-brand-near-black dark:text-white',
        mono && 'font-mono text-[11px]')}>
        <span className="inline-flex max-w-full items-center justify-end gap-1.5">
          <span className="min-w-0 break-all">{value}</span>{trailing}
        </span>
      </dd>
    </div>
  );
}
