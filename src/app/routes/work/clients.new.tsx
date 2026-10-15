import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, LockKeyhole, MailCheck, UserPlus } from 'lucide-react';
import { WizardProvider, type OnBehalfOf } from '@/contexts/WizardContext';
import { ManagedWizard } from '@/app/routes/admin/projects.new';
import { inviteMyClient, InviteClientFailed } from '@/lib/supabase/contractor-clients';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

// =========================================================
// /work/clients/new — a partner contractor brings their own client (109)
//
// The thing that makes a partner a partner. Until now their client had to be onboarded
// by an admin, so the distinction existed in conversation and nowhere in the product.
//
// ── Two halves, and only the first is new ────────────────────────────────────────────
// 1. Create the client's account. The SERVER sends an invitation directly to the client,
//    who must choose their own password before accessing the account. The contractor
//    receives the client's id for the project wizard and never receives a credential.
// 2. Build the project. This is the SAME eleven-step wizard an admin runs, rendered
//    through the same `ManagedWizard`, so the two cannot drift into different estimates
//    for the same building.
//
// ── Why the account comes first ──────────────────────────────────────────────────────
// The project needs an owner, and 109's policies only permit a project whose owner is a
// client this contractor actually brought on. So the link has to exist before the wizard
// writes anything — which also means a half-finished wizard leaves a real client account
// and no project, rather than a project nobody owns.
//
// ── The gate (116) ───────────────────────────────────────────────────────────────────
// A contractor who has not finished onboarding cannot bring a client. §3.2 of the partner
// agreement: Jalla may withhold activation until the required forms are complete. The
// dashboard hides the button, and this page refuses as well — a hidden button is not a
// gate when the URL is typeable.
// =========================================================

export default function WorkNewClient() {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [client, setClient]     = useState<OnBehalfOf | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  // null = not yet known, or 116 is not applied. Only a definite `false` refuses, so a
  // failed read never locks a partner out of a feature they have.
  const [mayOnboard, setMayOnboard] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await onboardingAvailable())) { if (alive) setMayOnboard(true); return; }
        const st = await fetchOnboardingStatus();
        if (alive) setMayOnboard(st.complete);
      } catch { if (alive) setMayOnboard(true); }
    })();
    return () => { alive = false; };
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) { setError(t('contractorClient.errName')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('contractorClient.errEmail')); return; }

    setBusy(true);
    try {
      const { clientId } = await inviteMyClient(fullName.trim(), email.trim());
      setShowConfirmation(true);
      setClient({
        userId: clientId,
        label: fullName.trim(),
        // Null, not a fixed plan: a partner's client may be on any of the three, so the
        // wizard's own plan step asks instead of being skipped.
        //
        // Naming one here would have been a label the database contradicts — the clamp
        // (061/062) rewrites any paid tier from a non-admin browser request back to the
        // free plan unless the client's subscription already entitles them.
        tier: null,
        by: 'partner',
      });
    } catch (err) {
      const code = err instanceof InviteClientFailed ? err.code : '';
      setError(
        code === 'client_exists' ? t('contractorClient.errExists')
        : code === 'self_invite'  ? t('contractorClient.errSelf')
        : code === 'invalid_email' ? t('contractorClient.errEmail')
        : code === 'Not found'  ? t('contractorClient.errNotContractor')
        : t('contractorClient.errFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  // The gate. Before anything else on this page, including the form.
  if (mayOnboard === false) {
    return (
      <div className="p-6 sm:p-8">
        <Link to="/work" className="inline-flex items-center gap-1 text-sm text-brand-mid-grey hover:text-brand-near-black">
          <ArrowLeft className="size-3.5" /> {t('contractorClient.back')}
        </Link>
        <div className="mt-6 max-w-xl rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#141414]">
            <LockKeyhole className="size-5 text-brand-near-black dark:text-white" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-brand-near-black dark:text-white">
            {t('contractorOnboarding.gateTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-brand-mid-grey">{t('contractorOnboarding.gateBody')}</p>
          <Link
            to="/work/onboarding"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
          >
            {t('contractorOnboarding.gateCta')}
          </Link>
        </div>
      </div>
    );
  }

  if (client && showConfirmation) {
    return (
      <div className="p-6 sm:p-8">
        <header className="mb-6 max-w-xl">
          <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#1e1e1e]">
            <MailCheck className="size-5 text-brand-near-black dark:text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
            {t('contractorClient.accountCreatedTitle', { name: client.label })}
          </h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorClient.invitationBody')}</p>
        </header>

        <div className="max-w-xl rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t('contractorClient.emailSentTo')}</p>
          <p className="mt-1 break-all text-sm text-brand-near-black dark:text-white">{email.trim()}</p>
          <p className="mt-4 rounded-xl bg-brand-off-white px-3 py-2.5 text-xs leading-relaxed text-brand-near-black dark:bg-[#111] dark:text-white">
            {t('contractorClient.passwordPrivacy')}
          </p>
        </div>

        <Button onClick={() => setShowConfirmation(false)} className="mt-6">
          {t('contractorClient.continueToWizard')}
        </Button>
      </div>
    );
  }

  // Once the client exists and the invitation is sent, this is the admin's wizard.
  if (client) {
    return (
      <WizardProvider onBehalfOf={client}>
        <ManagedWizard />
      </WizardProvider>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <Link to="/work" className="inline-flex items-center gap-1 text-sm text-brand-mid-grey hover:text-brand-near-black">
        <ArrowLeft className="size-3.5" /> {t('contractorClient.back')}
      </Link>

      <header className="mt-4 mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('contractorClient.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('contractorClient.subtitle')}</p>
      </header>

      <form onSubmit={invite} noValidate className="max-w-xl space-y-5 rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="space-y-1.5">
          <Label htmlFor="clientName">{t('contractorClient.name')}</Label>
          <Input id="clientName" autoComplete="off" value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clientEmail">{t('contractorClient.email')}</Label>
          <Input id="clientEmail" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
          <p className="text-xs text-brand-mid-grey">{t('contractorClient.emailHint')}</p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#111] dark:text-white">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={busy} className="inline-flex items-center gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {busy ? t('contractorClient.inviting') : t('contractorClient.submit')}
          </Button>
          <span className="text-xs text-brand-mid-grey">{t('contractorClient.submitHint')}</span>
        </div>

        <div className="pt-1">
          <p className="text-xs text-brand-mid-grey">{t('contractorClient.planNote')}</p>
        </div>
      </form>
    </div>
  );
}
