import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, LockKeyhole, MailCheck, UserPlus } from 'lucide-react';
import { WizardProvider, type OnBehalfOf } from '@/contexts/WizardContext';
import { ManagedWizard } from '@/app/routes/admin/projects.new';
import { fetchPendingClients, inviteMyClient, InviteClientFailed, type PendingContractorClient } from '@/lib/supabase/contractor-clients';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';
import { useAuth } from '@/contexts/AuthContext';
import {
  readClientOnboardingDraft, saveClientOnboardingDraft, clearClientOnboardingDraft,
  clientProjectDraftKey,
} from '@/lib/contractor/client-onboarding-draft';
import { clearWizardDraft } from '@/lib/projects/wizard-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/PhoneField';
import { isE164 } from '@/lib/phone';
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
// 2. Build the project through the same `ManagedWizard` an admin runs. Contractor-created
//    client projects use Self Verify automatically, so the plan picker is skipped.
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
  const { user } = useAuth();
  const contractorId = user?.id;
  const activeActor = useRef(contractorId);
  activeActor.current = contractorId;
  const mounted = useRef(true);
  const inviteOperation = useRef(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  // E.164, from PhoneField. Required: profiles.phone is the only thing WhatsApp
  // delivery resolves a destination from, and without it this client could never be
  // reached on the channel most of them actually read.
  const [phone, setPhone]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [client, setClient]     = useState<OnBehalfOf | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [resumingClient, setResumingClient] = useState(false);
  const [pendingClients, setPendingClients] = useState<PendingContractorClient[]>([]);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // null = not yet known, or 116 is not applied. Only a definite `false` refuses, so a
  // failed read never locks a partner out of a feature they have.
  const [mayOnboard, setMayOnboard] = useState<boolean | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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

  useEffect(() => {
    if (!contractorId) return;
    let alive = true;
    setReadyFor(null);
    setLoadFailed(false);
    setBusy(false);
    setError(null);
    fetchPendingClients().then(clients => {
      if (!alive) return;
      setPendingClients(clients);
      const saved = readClientOnboardingDraft(contractorId);
      // A browser draft is a convenience, never permission to create for an account.
      // Only restore a client the server still confirms belongs to this contractor.
      const linked = saved?.clientId
        ? clients.find(row => row.clientId === saved.clientId)
        : !saved && clients.length === 1 ? clients[0] : undefined;
      if (linked) {
        const phase = saved?.phase === 'wizard' ? 'wizard' : 'confirmation';
        setFullName(linked.fullName);
        setEmail(linked.email);
        setClient({ userId: linked.clientId, label: linked.fullName, tier: 'self_verify', by: 'partner' });
        setShowConfirmation(phase === 'confirmation');
        setResumingClient(true);
        saveClientOnboardingDraft(contractorId, {
          clientId: linked.clientId, fullName: linked.fullName, email: linked.email, phase,
        });
      } else {
        if (saved?.clientId) {
          clearClientOnboardingDraft(contractorId);
          clearWizardDraft(clientProjectDraftKey(contractorId, saved.clientId));
        }
        setClient(null);
        setShowConfirmation(false);
        setResumingClient(false);
        setFullName(saved?.phase === 'details' ? saved.fullName : '');
        setEmail(saved?.phase === 'details' ? saved.email : '');
      }
      setReadyFor(contractorId);
    }).catch(() => {
      if (alive) setLoadFailed(true);
    });
    return () => { alive = false; };
  }, [contractorId, loadAttempt]);

  useEffect(() => {
    if (!contractorId || readyFor !== contractorId || client) return;
    saveClientOnboardingDraft(contractorId, { clientId: null, fullName, email, phase: 'details' });
  }, [contractorId, readyFor, client, fullName, email]);

  function resumeClient(row: PendingContractorClient) {
    if (!contractorId || busy) return;
    saveClientOnboardingDraft(contractorId, {
      clientId: row.clientId, fullName: row.fullName, email: row.email, phase: 'wizard',
    });
    setFullName(row.fullName);
    setEmail(row.email);
    setClient({ userId: row.clientId, label: row.fullName, tier: 'self_verify', by: 'partner' });
    setShowConfirmation(false);
    setResumingClient(true);
  }

  function continueToProject() {
    if (!contractorId || !client) return;
    saveClientOnboardingDraft(contractorId, {
      clientId: client.userId, fullName: client.label, email: email.trim(), phase: 'wizard',
    });
    setShowConfirmation(false);
    setResumingClient(false);
  }

  function startAnotherClient() {
    if (!contractorId) return;
    // Keep each client's project answers; selecting them from the list restores them.
    saveClientOnboardingDraft(contractorId, { clientId: null, fullName: '', email: '', phase: 'details' });
    setClient(null);
    setShowConfirmation(false);
    setResumingClient(false);
    setFullName('');
    setEmail('');
    setPhone('');
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!contractorId || readyFor !== contractorId) return;
    setError(null);
    if (fullName.trim().length < 2) { setError(t('contractorClient.errName')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('contractorClient.errEmail')); return; }
    if (!isE164(phone)) { setError(t('contractorClient.errPhone')); return; }

    const owner = contractorId;
    const operation = ++inviteOperation.current;
    const name = fullName.trim();
    const address = email.trim();
    const isCurrent = () => mounted.current && activeActor.current === owner && inviteOperation.current === operation;
    setBusy(true);
    try {
      const { clientId } = await inviteMyClient(name, address, phone);
      // Save before showing Next, so leaving immediately never strands the new account.
      saveClientOnboardingDraft(owner, {
        clientId, fullName: name, email: address, phase: 'confirmation',
      });
      if (!isCurrent()) return;
      setFullName(name);
      setEmail(address);
      setPendingClients(rows => [{ clientId, fullName: name, email: address, invitedAt: new Date().toISOString() }, ...rows]);
      setShowConfirmation(true);
      setResumingClient(false);
      setClient({
        userId: clientId,
        label: name,
        // Contractor-created client projects are Self Verify. The fixed tier lets the
        // shared wizard skip plan selection and continue straight to the budget.
        tier: 'self_verify',
        by: 'partner',
      });
    } catch (err) {
      if (!isCurrent()) return;
      const code = err instanceof InviteClientFailed ? err.code : '';
      setError(
        code === 'client_exists' ? t('contractorClient.errExists')
        : code === 'self_invite'  ? t('contractorClient.errSelf')
        : code === 'invalid_email' ? t('contractorClient.errEmail')
        : code === 'Not found'  ? t('contractorClient.errNotContractor')
        : t('contractorClient.errFailed'),
      );
    } finally {
      if (isCurrent()) setBusy(false);
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

  if (loadFailed) {
    return (
      <div className="max-w-xl space-y-4 p-6 sm:p-8">
        <p role="alert" className="text-sm text-brand-mid-grey">{t('contractorClient.resumeFailed')}</p>
        <Button onClick={() => { setLoadFailed(false); setLoadAttempt(value => value + 1); }}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (!contractorId || readyFor !== contractorId) {
    return <p className="flex items-center gap-2 p-6 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
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
          <p className="mt-1 text-sm text-brand-mid-grey">{t(resumingClient ? 'contractorClient.resumeAccountBody' : 'contractorClient.invitationBody')}</p>
        </header>

        <div className="max-w-xl rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t(resumingClient ? 'contractorClient.email' : 'contractorClient.emailSentTo')}</p>
          <p className="mt-1 break-all text-sm text-brand-near-black dark:text-white">{email.trim()}</p>
          <p className="mt-4 rounded-xl bg-brand-off-white px-3 py-2.5 text-xs leading-relaxed text-brand-near-black dark:bg-[#111] dark:text-white">
            {t('contractorClient.passwordPrivacy')}
          </p>
        </div>

        <Button onClick={continueToProject} className="mt-6">
          {t('contractorClient.continueToWizard')}
        </Button>
        <button type="button" onClick={startAnotherClient} className="ml-4 text-sm text-brand-mid-grey underline underline-offset-4">
          {t('contractorClient.anotherClient')}
        </button>
      </div>
    );
  }

  // Once the client exists and the invitation is sent, this is the admin's wizard.
  if (client) {
    return (
      <WizardProvider
        key={`${contractorId}:${client.userId}`}
        onBehalfOf={client}
        persistenceKey={clientProjectDraftKey(contractorId, client.userId)}
        onReset={() => clearClientOnboardingDraft(contractorId)}
        onChangeClient={startAnotherClient}
      >
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

      {pendingClients.length > 0 && (
        <section className="mb-6 max-w-xl rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-base font-semibold text-brand-near-black dark:text-white">{t('contractorClient.resumeTitle')}</h2>
          <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorClient.resumeBody')}</p>
          <ul className="mt-4 space-y-3">
            {pendingClients.map(row => (
              <li key={row.clientId} className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-border-grey pt-3 dark:border-[#2c2c2c]">
                <div><p className="text-sm font-medium text-brand-near-black dark:text-white">{row.fullName}</p><p className="break-all text-xs text-brand-mid-grey">{row.email}</p></div>
                <Button type="button" disabled={busy} onClick={() => resumeClient(row)}>{t('contractorClient.resumeCta')}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={invite} noValidate className="max-w-xl space-y-5 rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="space-y-1.5">
          <Label htmlFor="clientName">{t('contractorClient.name')}</Label>
          <Input id="clientName" autoComplete="off" disabled={busy} value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clientEmail">{t('contractorClient.email')}</Label>
          <Input id="clientEmail" type="email" autoComplete="off" disabled={busy} value={email} onChange={e => setEmail(e.target.value)} />
          <p className="text-xs text-brand-mid-grey">{t('contractorClient.emailHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clientPhone">{t('contractorClient.phone')}</Label>
          {/* The country is picked, not assumed: a diaspora client building at home
              often holds a foreign number, and silently prefixing +237 would store
              one that reaches nobody. */}
          <PhoneField id="clientPhone" required disabled={busy} value={phone} onChange={setPhone} />
          <p className="text-xs text-brand-mid-grey">{t('contractorClient.phoneHint')}</p>
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
