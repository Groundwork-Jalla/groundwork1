import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, Check, ChevronDown, FileText, Landmark, Loader2,
  Lock, Phone, ShieldCheck, Upload, UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT, type TKey } from '@/lib/i18n';
import { normalisePhone, isE164 } from '@/lib/phone';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import {
  ONBOARDING_STEPS, acceptAgreement, fetchOnboardingRecord, fetchOnboardingStatus,
  saveBusiness, saveEmergencyContacts, saveIdentity, uploadDocument,
  type EmergencyContact, type OnboardingStatus, type OnboardingStep,
} from '@/lib/supabase/contractor-onboarding';
import { cn } from '@/lib/utils';

// =========================================================
// /work/onboarding — the one sequence every contractor completes.
//
// Six steps, in the order the partner onboarding form asks for them. The sequence is the
// same whether somebody applied and was approved, signed up at the open door, or was
// invited onto a single project: §3.1 of the partner agreement requires the same
// diligence from all of them, and tier decides what they are paid, not what we hold.
//
// ── Why the steps are not a wizard ───────────────────────────────────────────────────
// A wizard would make step 4 unreachable until step 3 was done, and step 3 is "add your
// payout details", which lives on another page. Somebody who has a licence to hand but
// not their sister's phone number should be able to finish the licence. So: a checklist
// anybody can work through in any order, with one honest progress count at the top.
//
// Every "done" mark comes from the database (116), never from local state, so a step
// cannot look finished because the browser thinks it saved.
// =========================================================

const STEP_ICON: Record<OnboardingStep, typeof UserRound> = {
  identity: UserRound, professional: FileText, payout: Landmark,
  emergency: Phone, documents: Upload, agreements: ShieldCheck,
};

export default function ContractorOnboarding() {
  const t = useT();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [open, setOpen] = useState<OnboardingStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await fetchOnboardingStatus()); setError(null); }
    catch { setError(t('contractorOnboarding.loadFailed')); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Open the first unfinished step, once, so arriving here lands on something to do
  // rather than on a wall of collapsed rows.
  const picked = useRef(false);
  useEffect(() => {
    if (!status || picked.current) return;
    picked.current = true;
    setOpen(ONBOARDING_STEPS.find(s => !status.steps[s]) ?? null);
  }, [status]);

  if (error) {
    return <p role="alert" className="m-6 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e] dark:text-white">{error}</p>;
  }
  if (!status) {
    return <div className="flex justify-center p-12"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  const done = ONBOARDING_STEPS.filter(s => status.steps[s]).length;
  const after = (next: OnboardingStatus) => {
    setStatus(next);
    // Move them along to whatever is still outstanding rather than leaving a finished
    // step expanded.
    setOpen(ONBOARDING_STEPS.find(s => !next.steps[s]) ?? null);
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('contractorOnboarding.title')}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorOnboarding.subtitle')}</p>
      </header>

      {/* Progress. A real count of real steps — not a percentage invented to look busy. */}
      <div className="mb-6 max-w-2xl">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold">
          <span className="text-brand-near-black dark:text-white">
            {status.complete
              ? t('contractorOnboarding.allDone')
              : t('contractorOnboarding.progress', { done: String(done), total: '6' })}
          </span>
          {status.complete && (
            <span className="inline-flex items-center gap-1 text-state-success"><Check className="size-3.5" />{t('contractorOnboarding.verifiedBadge')}</span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-off-white dark:bg-[#2c2c2c]" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={6}>
          <div className="h-full rounded-full bg-brand-near-black transition-all dark:bg-white" style={{ width: `${(done / 6) * 100}%` }} />
        </div>
      </div>

      <div className="max-w-2xl space-y-3">
        {ONBOARDING_STEPS.map(step => (
          <StepCard
            key={step}
            step={step}
            done={status.steps[step]}
            open={open === step}
            onToggle={() => setOpen(open === step ? null : step)}
          >
            {step === 'identity'     && <IdentityForm onSaved={after} />}
            {step === 'professional' && <BusinessForm onSaved={after} />}
            {step === 'payout'       && <PayoutStep done={status.steps.payout} />}
            {step === 'emergency'    && <EmergencyForm onSaved={after} />}
            {step === 'documents'    && <DocumentsForm status={status} onSaved={after} />}
            {step === 'agreements'   && <AgreementsForm onSaved={after} />}
          </StepCard>
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, done, open, onToggle, children }: {
  step: OnboardingStep; done: boolean; open: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  const t = useT();
  const Icon = STEP_ICON[step];
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
          done ? 'bg-state-success text-white' : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#2c2c2c]',
        )}>
          {done ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-brand-near-black dark:text-white">
            {t(`contractorOnboarding.step.${step}.title` as TKey)}
          </span>
          <span className="mt-0.5 block text-xs text-brand-mid-grey">
            {done
              ? t('contractorOnboarding.stepDone')
              : t(`contractorOnboarding.step.${step}.hint` as TKey)}
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-brand-mid-grey transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="border-t border-brand-border-grey px-5 py-5 dark:border-[#2c2c2c]">{children}</div>}
    </section>
  );
}

/** Shared submit/error footing, so every step fails the same way. */
function useSave(onSaved: (s: OnboardingStatus) => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<OnboardingStatus>) => {
    setBusy(true); setErr(null);
    try { onSaved(await fn()); }
    catch (e) {
      // The database refuses with a named code; anything else is unexpected and gets the
      // generic line rather than a raw Postgres string.
      const msg = (e as { message?: string })?.message ?? '';
      const code = /^([a-z_]+):/.exec(msg)?.[1];
      setErr(code ? t(`contractorOnboarding.err.${code}` as TKey) : t('contractorOnboarding.err.generic'));
    }
    finally { setBusy(false); }
  };
  return { busy, err, run };
}

function Err({ children }: { children: React.ReactNode }) {
  return children ? <p role="alert" className="text-xs text-state-alert">{children}</p> : null;
}

function IdentityForm({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    void fetchOnboardingRecord().then(r => {
      setDob(r.dateOfBirth ?? ''); setAddress(r.address ?? '');
    }).catch(() => {});
  }, []);

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(() => saveIdentity(dob, address)); }}>
      <div className="space-y-1.5">
        <Label htmlFor="dob">{t('contractorOnboarding.dob')}</Label>
        {/* A date input, not three text boxes: it validates itself and avoids the
            DD/MM vs MM/DD ambiguity the paper form has to spell out. */}
        {/* `max` is the first line: the picker will not offer a date under 18 years ago.
            `save_contractor_identity` refuses the same thing by name, for a typed date. */}
        <Input
          id="dob" type="date" required value={dob} onChange={e => setDob(e.target.value)}
          max={new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10)}
          min={new Date(Date.now() - 100 * 365.25 * 864e5).toISOString().slice(0, 10)}
          className="max-w-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="addr">{t('contractorOnboarding.address')}</Label>
        <textarea
          id="addr" required rows={3} value={address} onChange={e => setAddress(e.target.value)}
          className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#444] dark:bg-[#141414] dark:text-white"
        />
        <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.addressHint')}</p>
      </div>
      <Err>{err}</Err>
      <Button type="submit" disabled={busy}>{busy ? t('contractorOnboarding.saving') : t('contractorOnboarding.save')}</Button>
    </form>
  );
}

function BusinessForm({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [license, setLicense] = useState('');
  const [kind, setKind] = useState<'registered' | 'independent' | ''>('');
  const [name, setName] = useState('');
  const [reg, setReg] = useState('');

  useEffect(() => {
    void fetchOnboardingRecord().then(r => {
      setLicense(r.licenseNumber ?? '');
      // Reopening with the saved answer selected. If this is left blank, re-saving the
      // other option clears the company details and deletes the registration document.
      setKind(r.businessStatus ?? '');
      setName(r.businessName ?? ''); setReg(r.businessRegNumber ?? '');
    }).catch(() => {});
  }, []);

  return (
    <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      if (!kind) return;
      void run(() => saveBusiness({
        licenseNumber: license, businessStatus: kind,
        businessName: name, businessRegNumber: reg,
      }));
    }}>
      <div className="space-y-1.5">
        <Label htmlFor="lic">{t('contractorOnboarding.licenseNumber')}</Label>
        <Input id="lic" required value={license} onChange={e => setLicense(e.target.value)} />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-brand-near-black dark:text-white">{t('contractorOnboarding.businessStatus')}</legend>
        {(['registered', 'independent'] as const).map(v => (
          <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-brand-border-grey p-3 text-sm dark:border-[#444]">
            <input type="radio" name="bstatus" value={v} checked={kind === v} onChange={() => setKind(v)} className="mt-0.5" required />
            <span>
              <span className="block font-medium text-brand-near-black dark:text-white">{t(`contractorOnboarding.${v}` as TKey)}</span>
              <span className="mt-0.5 block text-xs text-brand-mid-grey">{t(`contractorOnboarding.${v}Hint` as TKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Only a registered business is asked for these. An independent contractor who was
          shown them would have two fields they cannot fill and a step they cannot pass. */}
      {kind === 'registered' && (
        <div className="space-y-4 rounded-xl bg-brand-off-white p-4 dark:bg-[#141414]">
          <div className="space-y-1.5">
            <Label htmlFor="bname">{t('contractorOnboarding.businessName')}</Label>
            <Input id="bname" required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="breg">{t('contractorOnboarding.businessReg')}</Label>
            <Input id="breg" required value={reg} onChange={e => setReg(e.target.value)} />
          </div>
        </div>
      )}

      <Err>{err}</Err>
      <Button type="submit" disabled={busy || !kind}>{busy ? t('contractorOnboarding.saving') : t('contractorOnboarding.save')}</Button>
    </form>
  );
}

/**
 * The payout step owns nothing. It reports what /work/payouts (099) already holds.
 * Asking for account numbers here would create a second set and a question about which
 * one money follows.
 */
function PayoutStep({ done }: { done: boolean }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="text-sm text-brand-mid-grey">{t('contractorOnboarding.payoutBody')}</p>
      <Link
        to="/work/payouts"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
      >
        {done ? t('contractorOnboarding.payoutReview') : t('contractorOnboarding.payoutCta')}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

const BLANK: EmergencyContact = { fullName: '', relationship: '', phone: '' };

function EmergencyForm({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [rows, setRows] = useState<EmergencyContact[]>([BLANK, BLANK, BLANK]);
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    void fetchOnboardingRecord().then(r => {
      if (r.contacts.length === 3) setRows(r.contacts);
    }).catch(() => {});
  }, []);

  const set = (i: number, patch: Partial<EmergencyContact>) =>
    setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const submit = () => {
    // Normalise to E.164 before sending. The column CHECK would refuse a local number
    // outright, and "+237" is not something a contractor should have to know to type.
    const out = rows.map(r => ({ ...r, phone: normalisePhone(r.phone, DEFAULT_COUNTRY_CODE) ?? r.phone }));
    const bad = out.findIndex(r => !isE164(r.phone));
    if (bad >= 0) { setLocal(t('contractorOnboarding.err.badPhone', { n: String(bad + 1) })); return; }
    setLocal(null);
    void run(() => saveEmergencyContacts(out));
  };

  return (
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); submit(); }}>
      <p className="text-sm text-brand-mid-grey">{t('contractorOnboarding.emergencyBody')}</p>
      {rows.map((r, i) => (
        <fieldset key={i} className="space-y-3 rounded-xl border border-brand-border-grey p-4 dark:border-[#444]">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
            {t('contractorOnboarding.contactN', { n: String(i + 1) })}
          </legend>
          <div className="space-y-1.5">
            <Label htmlFor={`cn${i}`}>{t('contractorOnboarding.contactName')}</Label>
            <Input id={`cn${i}`} required value={r.fullName} onChange={e => set(i, { fullName: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`cr${i}`}>{t('contractorOnboarding.contactRelationship')}</Label>
              <Input id={`cr${i}`} required value={r.relationship} onChange={e => set(i, { relationship: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cp${i}`}>{t('contractorOnboarding.contactPhone')}</Label>
              <Input id={`cp${i}`} type="tel" required value={r.phone} onChange={e => set(i, { phone: e.target.value })} />
            </div>
          </div>
        </fieldset>
      ))}
      <Err>{local ?? err}</Err>
      <Button type="submit" disabled={busy}>{busy ? t('contractorOnboarding.saving') : t('contractorOnboarding.saveAllThree')}</Button>
    </form>
  );
}

function DocumentsForm({ status, onSaved }: { status: OnboardingStatus; onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [have, setHave] = useState<Record<string, string>>({});

  const refresh = () => void fetchOnboardingRecord()
    .then(r => setHave(Object.fromEntries(r.documents.map(d => [d.kind, d.filename]))))
    .catch(() => {});
  useEffect(refresh, []);

  const pick = (kind: 'professional_license' | 'business_registration') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';  // so re-picking the same file fires onChange again
      if (file) void run(() => uploadDocument(kind, file)).then(refresh);
    };

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-mid-grey">{t('contractorOnboarding.documentsBody')}</p>

      <DocSlot
        label={t('contractorOnboarding.docLicense')}
        hint={t('contractorOnboarding.docLicenseHint')}
        filename={have.professional_license} busy={busy} onPick={pick('professional_license')}
      />
      {/* Only a registered business owes this one — 116 says so, and this reads its answer
          rather than deciding separately. */}
      {status.needsBusinessDoc && (
        <DocSlot
          label={t('contractorOnboarding.docBusiness')}
          hint={t('contractorOnboarding.docBusinessHint')}
          filename={have.business_registration} busy={busy} onPick={pick('business_registration')}
        />
      )}

      <p className="flex items-start gap-1.5 text-xs text-brand-mid-grey">
        <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />{t('contractorOnboarding.docsPrivate')}
      </p>
      <Err>{err}</Err>
    </div>
  );
}

function DocSlot({ label, hint, filename, busy, onPick }: {
  label: string; hint: string; filename?: string; busy: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border-grey p-4 dark:border-[#444]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">{label}</p>
        <p className="mt-0.5 truncate text-xs text-brand-mid-grey">
          {filename ? <span className="inline-flex items-center gap-1 text-state-success"><Check className="size-3" />{filename}</span> : hint}
        </p>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-brand-border-grey px-3.5 py-2 text-xs font-semibold text-brand-near-black dark:border-[#444] dark:text-white">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" aria-hidden />}
        {filename ? t('contractorOnboarding.replace') : t('contractorOnboarding.upload')}
        <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" disabled={busy} onChange={onPick} />
      </label>
    </div>
  );
}

const AGREEMENTS = [
  { key: 'terms_of_service',  href: '/terms' },
  { key: 'partner_agreement', href: '/partner-agreement' },
] as const;

function AgreementsForm({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [read, setRead] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-5">
      <p className="text-sm text-brand-mid-grey">{t('contractorOnboarding.agreementsBody')}</p>
      {AGREEMENTS.map(a => (
        <form
          key={a.key}
          className="space-y-3 rounded-xl border border-brand-border-grey p-4 dark:border-[#444]"
          onSubmit={e => { e.preventDefault(); void run(() => acceptAgreement(a.key, signed[a.key] ?? '')); }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-brand-near-black dark:text-white">
              {t(`contractorOnboarding.doc.${a.key}` as TKey)}
            </p>
            <Link to={a.href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline text-brand-near-black dark:text-white">
              {t('contractorOnboarding.readIt')}
            </Link>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-xs text-brand-mid-grey">
            <input
              type="checkbox" className="mt-0.5" required
              checked={read[a.key] ?? false}
              onChange={e => setRead(r => ({ ...r, [a.key]: e.target.checked }))}
            />
            {t('contractorOnboarding.confirmRead')}
          </label>

          <div className="space-y-1.5">
            <Label htmlFor={`sig-${a.key}`}>{t('contractorOnboarding.typeName')}</Label>
            {/* §24.9 permits electronic signature. What makes it one is that they type
                their own name, so it is never prefilled from the profile. */}
            <Input
              id={`sig-${a.key}`} required autoComplete="off"
              value={signed[a.key] ?? ''}
              onChange={e => setSigned(s => ({ ...s, [a.key]: e.target.value }))}
            />
          </div>

          <Button type="submit" disabled={busy || !(read[a.key] ?? false)}>
            {busy ? t('contractorOnboarding.saving') : t('contractorOnboarding.sign')}
          </Button>
        </form>
      ))}
      <Err>{err}</Err>
    </div>
  );
}
