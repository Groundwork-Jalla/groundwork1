import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';
import { WizardProvider, type OnBehalfOf } from '@/contexts/WizardContext';
import { ManagedWizard } from '@/app/routes/admin/projects.new';
import { inviteMyClient, InviteClientFailed } from '@/lib/supabase/contractor-clients';
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
// 1. Invite the client. The SERVER does this, and it invites rather than provisions —
//    the account and the only way into it are created together, and the client chooses
//    their own password. A contractor never holds a credential for somebody else.
// 2. Build the project. This is the SAME eleven-step wizard an admin runs, rendered
//    through the same `ManagedWizard`, so the two cannot drift into different estimates
//    for the same building.
//
// ── Why the invitation comes first ───────────────────────────────────────────────────
// The project needs an owner, and 109's policies only permit a project whose owner is a
// client this contractor actually brought on. So the link has to exist before the wizard
// writes anything — which also means a half-finished wizard leaves an invited client and
// no project, rather than a project nobody owns.
// =========================================================

export default function WorkNewClient() {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [client, setClient]     = useState<OnBehalfOf | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) { setError(t('contractorClient.errName')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('contractorClient.errEmail')); return; }

    setBusy(true);
    try {
      const { clientId } = await inviteMyClient(fullName.trim(), email.trim());
      setClient({
        userId: clientId,
        label: fullName.trim(),
        // A client a partner brings on IS a Jalla Management build — Jalla stands behind
        // the work whoever introduced them. It also sidesteps the free plan's three
        // project cap, which counts the CLIENT's projects and would otherwise have
        // failed at the END of the eleven step wizard with a raw database message.
        tier: 'jalla_management',
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

  // Once the client exists, this is the admin's wizard, unchanged.
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
      </form>
    </div>
  );
}
