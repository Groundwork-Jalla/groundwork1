import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Send, ShieldCheck } from 'lucide-react';
import { listVerifierDirectory, type VerifierDirectory } from '@/lib/supabase/verifiers';
import { inviteVerifier } from '@/lib/supabase/verifier-claim';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/verifiers — the operator's directory of independent verifiers (01 §3 PEOPLE).
//
// ── Management, not execution ────────────────────────────────────────────────────────
// This is NOT /verifiers. That surface is where a verifier records what they found on
// site; this one answers the operator's question — who can verify, in what discipline,
// where, are they available, what are they carrying, and when did we last hear from
// them. Same rows (086 `verifier_profiles` / `project_verifiers`, 087
// `stage_verifications`), different actor. Nothing here records a finding.
//
// Assignment stays where the work is: a verifier is put on a project from that project's
// workspace, through `assign_verifier`. Duplicating that here would be two doors onto one
// act, and they would drift.
//
// ── Inviting is management, so it does live here (105) ───────────────────────────────
// Deciding that an interviewed engineer should be a verifier is this screen's question,
// not a project's. The invitation emails them a link to /verifier-signup, where they set
// their own password — staff never choose one for them. The token never reaches this
// browser: it is issued and mailed server-side.
// =========================================================

export default function AdminVerifiers() {
  const t = useT();
  const [data, setData] = useState<VerifierDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await listVerifierDirectory()); setError(null); }
    catch (err) { setData({ rows: [], profilesAvailable: false, verificationsAvailable: false }); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.verifiers.title')}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.verifiers.subtitle')}</p>
      </header>

      <InviteVerifier onInvited={load} />

      {data === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{error}</p>
      ) : data.rows.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<ShieldCheck className="size-8" />} title={t('admin.verifiers.empty')} description={t('admin.verifiers.emptyBody')} />
        </div>
      ) : (
        <>
          {!data.profilesAvailable && (
            <p className="rounded-2xl border border-brand-border-grey bg-white px-5 py-3 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              {t('admin.verifiers.profilesUnavailable')}
            </p>
          )}
          <ul className="space-y-3">
            {data.rows.map(v => (
              <li key={v.userId} className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-brand-near-black dark:text-white">
                      {v.name || v.email}
                      {v.available !== null && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          v.available
                            ? 'bg-state-complete/10 text-state-complete'
                            : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]')}>
                          {t(v.available ? 'admin.verifiers.available' : 'admin.verifiers.unavailable')}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                      {v.name ? `${v.email}` : ''}
                      {v.city && ` · ${v.city}`}
                      {v.registrationBody && ` · ${v.registrationBody}${v.registrationNo ? ` ${v.registrationNo}` : ''}`}
                    </p>
                    <p className="mt-1 text-[11px] text-brand-mid-grey">
                      {v.disciplines === null
                        ? t('admin.verifiers.noProfile')
                        : v.disciplines.length === 0
                          ? t('admin.verifiers.noDisciplines')
                          : v.disciplines.join(' · ')}
                    </p>
                  </div>
                  <dl className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
                    <Stat label={t('admin.verifiers.projects')} value={data.profilesAvailable ? String(v.activeProjects) : t('admin.clients.notAvailable')} />
                    <Stat label={t('admin.verifiers.pending')} value={data.verificationsAvailable ? String(v.pending) : t('admin.clients.notAvailable')} emphasis={v.pending > 0} />
                    <Stat label={t('admin.verifiers.decided')} value={data.verificationsAvailable ? String(v.decided) : t('admin.clients.notAvailable')} />
                  </dl>
                </div>
                <p className="border-t border-brand-border-grey px-5 py-2.5 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c]">
                  {v.lastDecidedAt
                    ? t('admin.verifiers.lastDecision', { when: formatRelative(v.lastDecidedAt) })
                    : t('admin.verifiers.noDecisions')}
                  {' · '}{t('admin.verifiers.assignHint')}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-brand-muted-grey">{label}</dt>
      <dd className={cn('font-semibold tabular-nums', emphasis ? 'text-state-held' : 'text-brand-near-black dark:text-white')}>{value}</dd>
    </div>
  );
}


/**
 * Invite an interviewed engineer.
 *
 * Re-inviting the same address is safe and deliberate: `issue_verifier_invite` is
 * idempotent for an open invitation, so it re-sends the link already in their inbox
 * rather than minting a second live one.
 */
function InviteVerifier({ onInvited }: { onInvited: () => void }) {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [sent, setSent]         = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSent(null);
    if (fullName.trim().length < 2) { setError(t('admin.verifiers.inviteErrName')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('admin.verifiers.inviteErrEmail')); return; }

    setBusy(true);
    try {
      await inviteVerifier(email.trim(), fullName.trim());
      setSent(email.trim());
      setFullName(''); setEmail('');
      onInvited();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code.includes('already_verifier') ? t('admin.verifiers.inviteErrAlready')
             : code.includes('invited')          ? t('admin.verifiers.inviteErrSendOnly')
             : t('admin.verifiers.inviteErrFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.verifiers.inviteTitle')}</h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.verifiers.inviteBody')}</p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="vName">{t('admin.verifiers.inviteName')}</Label>
          <Input id="vName" autoComplete="off" value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vEmail">{t('admin.verifiers.inviteEmail')}</Label>
          <Input id="vEmail" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="inline-flex items-center gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {busy ? t('admin.verifiers.inviteSending') : t('admin.verifiers.inviteCta')}
        </Button>
      </form>

      {sent && (
        <p className="mt-3 flex items-center gap-2 text-xs text-state-complete">
          <Check className="size-3.5" />{t('admin.verifiers.inviteSent', { email: sent })}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}
    </section>
  );
}
