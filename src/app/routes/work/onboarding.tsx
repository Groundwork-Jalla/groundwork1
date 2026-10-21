import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, ArrowRight, Check, FileText, Landmark, Loader2, Lock,
  Phone, ShieldCheck, UserPlus, UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/PhoneField';
import { AgreementReader } from '@/components/contractor/AgreementReader';
import { PayoutDialog } from '@/components/contractor/PayoutDialog';
import { useT, type TKey } from '@/lib/i18n';
import { isE164 } from '@/lib/phone';
import {
  CONTRACTOR_ROLES, requiresLicence, type ContractorRole,
} from '@/lib/contractor/application-types';
import {
  SIGNABLE_AGREEMENTS, acceptAgreement, fetchOnboardingRecord, fetchOnboardingStatus,
  saveSpecialty, saveEmergencyContacts, saveIdentity, setClientIntent,
  type AgreementDocument, type ClientIntent, type EmergencyContact, type OnboardingStatus,
} from '@/lib/supabase/contractor-onboarding';
import { cn } from '@/lib/utils';
import { setPartnerInterest } from '@/lib/supabase/partner-application';
import {
  clearEmergencyContactDraft, readEmergencyContactDraft, saveEmergencyContactDraft,
} from '@/lib/contractor/emergency-contact-draft';
import { useAuth } from '@/contexts/AuthContext';

// =========================================================
// /work/onboarding — the one sequence every contractor completes.
//
// Same sequence whether somebody applied and was approved, signed up at the open door,
// or was invited onto a single project. §3.1 of the partner agreement asks the same
// diligence of all of them, and tier (Schedule B) decides what a partner is paid, never
// what Jalla holds on file.
//
// ── The agreement comes first ────────────────────────────────────────────────────────
// Nothing else is reachable until both documents are signed. The form asks for a date of
// birth, a home address, bank details and three next of kin; the document explaining
// what Jalla may do with all of that IS the agreement. Collecting it and explaining
// afterwards is backwards, so the five remaining steps render locked until it is done.
//
// ── Why panels and not one long form ─────────────────────────────────────────────────
// Eighteen fields on one screen reads as paperwork and gets abandoned halfway. These are
// small panels — at most three inputs each — with one question in view at a time. The
// three emergency contacts fall out of that naturally: one contact per panel, three
// fields apiece.
//
// The panels are presentation only. The six steps in the DATABASE are what "finished"
// means (116), and a panel is done when its underlying step says so — never because the
// browser thinks it saved.
// =========================================================

/** A panel is at most three inputs. Several panels can serve one database step. */
type PanelId = 'agreements' | 'you' | 'specialty' | 'payout' | 'contact';

export default function ContractorOnboarding() {
  const t = useT();
  const { user } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [at, setAt] = useState<PanelId>('agreements');
  const [error, setError] = useState<string | null>(null);

  // The three contacts live here, not in the panels: they are collected across three
  // screens and saved in one call, because 116 requires exactly three and a partial set
  // must never sit there looking finished.
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { fullName: '', relationship: '', phone: '' },
  ]);

  const load = useCallback(async () => {
    try { setStatus(await fetchOnboardingStatus()); setError(null); }
    catch { setError(t('contractorOnboarding.loadFailed')); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void fetchOnboardingRecord()
      .then(r => {
        // Saved contacts win: they are the record. A draft only fills in for somebody
        // who typed one or two and left before the single save could happen.
        if (r.contacts.length >= 1) { setContacts(r.contacts.slice(0, 1)); return; }
        const draft = user?.id ? readEmergencyContactDraft(user.id) : null;
        if (draft) setContacts(draft);
      })
      .catch(() => {});
  }, [user?.id]);

  // Keep the draft in step with what they have typed, so walking away mid-way through
  // the three contacts does not mean typing them all again.
  useEffect(() => {
    if (!user?.id || !status || status.steps.emergency) return;
    saveEmergencyContactDraft(user.id, contacts);
  }, [user?.id, contacts, status]);

  // Land on the first thing outstanding, once.
  const picked = useRef(false);
  useEffect(() => {
    if (!status || picked.current) return;
    picked.current = true;
    setAt(firstOpenPanel(status));
  }, [status]);

  if (error) {
    return <p role="alert" className="m-6 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e] dark:text-white">{error}</p>;
  }
  if (!status) {
    return <div className="flex justify-center p-12"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  const order = panelOrder(status);
  const index = Math.max(0, order.indexOf(at));
  const signed = status.steps.agreements;

  const advance = (next: OnboardingStatus) => {
    setStatus(next);
    // The three contacts are in the database now, so the local copy has no job left.
    if (next.steps.emergency && user?.id) clearEmergencyContactDraft(user.id);
    const ord = panelOrder(next);
    // Forward to the next panel that still needs something; if the current one is still
    // outstanding (a half-signed agreement, say), stay put.
    const here = ord.indexOf(at);
    const onward = ord.slice(here + 1).find(p => !panelDone(p, next));
    setAt(onward ?? (panelDone(at, next) ? ord[ord.length - 1] : at));
  };

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-8">
      <Progress order={order} index={index} status={status} />

      {status.complete
        ? (
          <AllDone
            onAnswered={async (intent, partner) => {
              // Recorded before anything navigates: somebody who says yes and then
              // abandons the form must still be visible in the funnel (133).
              await setPartnerInterest(partner);
              const next = await setClientIntent(intent);
              setStatus(next);
              // A full load, not a client-side navigate: the /work layout resolved the
              // gate before this answer existed, and would otherwise bounce them
              // straight back here. The same reason the role handoffs reload.
              // Having a client is a CONDITION of the partner application, so somebody
              // who says they have none is not sent to it — they used to be, which meant
              // filling in a form they could not qualify on. They get the dashboard and
              // can apply later, from the sidebar, when a project comes up.
              window.location.href = !partner || intent === 'no_client'
                ? '/work'
                : '/work/partner';
            }}
          />
        )
        : (
          <>
            {at === 'agreements' && <AgreementsPanel status={status} onSaved={advance} />}

            {/* Everything past the agreement is sealed until it is signed. Rendering it
                locked rather than hiding it means somebody can see what is coming. */}
            {at !== 'agreements' && !signed && <LockedNotice onBack={() => setAt('agreements')} />}

            {at !== 'agreements' && signed && (
              <Panel id={at}>
                {at === 'you'       && <YouPanel onSaved={advance} />}
                {at === 'specialty' && <SpecialtyPanel onSaved={advance} />}
                {at === 'payout'    && (
                  <PayoutPanel
                    done={status.steps.payout}
                    // The destination lands in payout_destinations (099), so the step's
                    // answer has to be re-read rather than assumed.
                    onAdded={async () => advance(await fetchOnboardingStatus())}
                  />
                )}
                {at === 'contact'   && (
                  <ContactPanel
                    contacts={contacts} setContacts={setContacts}
                    onSaved={advance}
                  />
                )}
              </Panel>
            )}
          </>
        )}

      {/* Back is always available; forward is each panel's own business, because it is
          the thing that knows whether what is on screen can be saved. */}
      {index > 0 && (
        <button
          type="button"
          onClick={() => setAt(order[index - 1])}
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white"
        >
          <ArrowLeft className="size-3.5" aria-hidden />{t('contractorOnboarding.back')}
        </button>
      )}
    </div>
  );
}

// ── Which panels exist, and when one is finished ─────────

/** A registered business owes two extra fields and a document; a sole trader does not. */
function panelOrder(_s: OnboardingStatus): PanelId[] {
  // Five steps, fixed (142). "How do you trade" is gone — the partner application still
  // asks whether they operate as an individual or a company, which is where it matters —
  // and the three emergency contacts are one, because speed onto the platform is what
  // this sequence is for.
  //
  // The contact is LAST on purpose: finishing it ends the form and brings up the
  // partner question.
  return ['agreements', 'you', 'specialty', 'payout', 'contact'];
}

function panelDone(p: PanelId, s: OnboardingStatus): boolean {
  switch (p) {
    case 'agreements': return s.steps.agreements;
    case 'you':        return s.steps.identity;
    case 'specialty':  return s.steps.professional;
    case 'payout':     return s.steps.payout;
    case 'contact':    return s.steps.emergency;
  }
}

function firstOpenPanel(s: OnboardingStatus): PanelId {
  const order = panelOrder(s);
  return order.find(p => !panelDone(p, s)) ?? order[0];
}

const PANEL_ICON: Record<PanelId, typeof UserRound> = {
  agreements: ShieldCheck, you: UserRound, specialty: FileText,
  payout: Landmark, contact: Phone,
};

// ── Chrome ───────────────────────────────────────────────

function Progress({ order, index, status }: {
  order: PanelId[]; index: number; status: OnboardingStatus;
}) {
  const t = useT();
  return (
    <div className="mb-7">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
        <span className="text-brand-near-black dark:text-white">
          {status.complete
            ? t('contractorOnboarding.allDone')
            : t('contractorOnboarding.panelOf', { n: String(index + 1), total: String(order.length) })}
        </span>
        {status.complete && (
          <span className="inline-flex items-center gap-1 text-state-success">
            <Check className="size-3.5" aria-hidden />{t('contractorOnboarding.verifiedBadge')}
          </span>
        )}
      </div>
      <div className="flex gap-1" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={order.length}>
        {order.map((p, i) => (
          <span key={p} className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            panelDone(p, status) ? 'bg-state-success'
              : i === index      ? 'bg-brand-near-black dark:bg-white'
              :                    'bg-brand-border-grey dark:bg-[#2c2c2c]',
          )} />
        ))}
      </div>
    </div>
  );
}

/** One question in view, with room around it. */
function Panel({ id, children }: { id: PanelId; children: React.ReactNode }) {
  const t = useT();
  const Icon = PANEL_ICON[id];
  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:p-7">
      <div className="mb-5">
        <span className="mb-3 inline-flex size-9 items-center justify-center rounded-full bg-brand-off-white text-brand-near-black dark:bg-[#141414] dark:text-white">
          <Icon className="size-4" aria-hidden />
        </span>
        <h1 className="text-xl font-bold leading-snug text-brand-near-black dark:text-white">
          {t(`contractorOnboarding.panel.${id}.title` as TKey)}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          {t(`contractorOnboarding.panel.${id}.body` as TKey)}
        </p>
      </div>
      {children}
    </section>
  );
}

function LockedNotice({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-7 text-center dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <span className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#141414]">
        <Lock className="size-5 text-brand-mid-grey" aria-hidden />
      </span>
      <h1 className="text-lg font-bold text-brand-near-black dark:text-white">{t('contractorOnboarding.lockedTitle')}</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-brand-mid-grey">{t('contractorOnboarding.lockedBody')}</p>
      <Button className="mt-5" onClick={onBack}>{t('contractorOnboarding.lockedCta')}</Button>
    </section>
  );
}

/**
 * The end of the form, and the one question that decides what happens next.
 *
 * A contractor here is one of two people: a partner who brought their own client, or
 * somebody waiting to be assigned to a build. The product used to guess and send
 * everybody to the dashboard. Now it asks, once, and the answer is recorded — which
 * also tells staff who the partners are without anybody having to ask.
 *
 * Until one of the two is pressed, the sidebar is inert (see work/_layout.tsx). These
 * really are the only two things on the screen that do anything.
 */
/**
 * The last screen of onboarding — now two questions, not one.
 *
 * "Onboarding is not complete unless they are able to decide whether they want to be
 * certified partners and fill the application form and book a call if qualified, or if
 * they simply stay with general access" (Philip, 21 Oct). So the partner decision is
 * asked here, where everybody passes, rather than left to a card they may never notice.
 *
 * The client-intent question is UNCHANGED and still answered second: it is what unlocks
 * the sidebar (118), and routing around it would leave somebody locked out of the app
 * they just joined. The partner answer only decides where they land afterwards.
 */
function AllDone({ onAnswered }: { onAnswered: (i: ClientIntent, partner: boolean) => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState<ClientIntent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [partner, setPartner] = useState<boolean | null>(null);

  const answer = async (intent: ClientIntent) => {
    setBusy(intent); setErr(null);
    try { await onAnswered(intent, partner === true); }
    catch { setErr(t('contractorOnboarding.err.generic')); setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-state-success/30 bg-white p-7 text-center dark:bg-[#1e1e1e]">
      <span className="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-full bg-state-success text-white">
        <Check className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-bold text-brand-near-black dark:text-white">
        {t('contractorOnboarding.doneTitle')}
      </h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-mid-grey">
        {t('contractorOnboarding.doneBody')}
      </p>

      <div className="mx-auto mt-6 max-w-sm rounded-xl border border-brand-border-grey p-4 text-left dark:border-[#2c2c2c]">
        <p className="text-xs font-semibold text-brand-near-black dark:text-white">
          {t('contractorOnboarding.partnerQ')}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-brand-mid-grey">
          {t('contractorOnboarding.partnerHint')}
        </p>
        <div className="mt-2.5 flex gap-2">
          {[true, false].map(v => (
            <button
              key={String(v)} type="button" disabled={busy !== null}
              onClick={() => setPartner(v)}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
                partner === v
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]')}
            >
              {t(v ? 'contractorOnboarding.partnerYes' : 'contractorOnboarding.partnerNo')}
            </button>
          ))}
        </div>
      </div>

      {/* The existing question, unchanged — and still what unlocks the sidebar. It waits
          for the partner answer so neither can be skipped. */}
      <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2.5">
        <Button
          type="button" disabled={busy !== null || partner === null}
          onClick={() => void answer('onboard_client')}
        >
          {busy === 'onboard_client'
            ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />{t('contractorOnboarding.saving')}</>
            : <><UserPlus className="mr-1.5 size-3.5" aria-hidden />{t('contractorOnboarding.haveClient')}</>}
        </Button>
        <button
          type="button" disabled={busy !== null || partner === null}
          onClick={() => void answer('no_client')}
          className="rounded-lg px-4 py-2.5 text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black disabled:opacity-50 dark:hover:text-white"
        >
          {busy === 'no_client' ? t('contractorOnboarding.saving') : t('contractorOnboarding.noClient')}
        </button>
      </div>

      {err && <p role="alert" className="mt-3 text-xs text-state-alert">{err}</p>}
    </section>
  );
}

/** Shared submit/error footing, so every panel fails the same way. */
function useSave(onSaved: (s: OnboardingStatus) => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<OnboardingStatus>) => {
    setBusy(true); setErr(null);
    try { onSaved(await fn()); return true; }
    catch (e) {
      // The database refuses with a named code; anything else gets the generic line
      // rather than a raw Postgres string.
      const msg = (e as { message?: string })?.message ?? '';
      const code = /^([a-z_]+):/.exec(msg)?.[1];
      setErr(code ? t(`contractorOnboarding.err.${code}` as TKey) : t('contractorOnboarding.err.generic'));
      return false;
    }
    finally { setBusy(false); }
  };
  return { busy, err, run, setErr };
}

function Err({ children }: { children: React.ReactNode }) {
  return children ? <p role="alert" className="mt-3 text-xs text-state-alert">{children}</p> : null;
}

function Next({ busy, label }: { busy: boolean; label?: string }) {
  const t = useT();
  return (
    <Button type="submit" disabled={busy} className="mt-5">
      {busy
        ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />{t('contractorOnboarding.saving')}</>
        : <>{label ?? t('contractorOnboarding.next')}<ArrowRight className="ml-1.5 size-3.5" aria-hidden /></>}
    </Button>
  );
}

// ── Panel 1: the agreements ──────────────────────────────

function AgreementsPanel({ status, onSaved }: {
  status: OnboardingStatus; onSaved: (s: OnboardingStatus) => void;
}) {
  const t = useT();
  const { busy, err, run, setErr } = useSave(onSaved);
  const [open, setOpen] = useState<AgreementDocument | null>(null);
  // Which ones this visit has signed. The database only reports "both or not", so
  // without this the first signature would leave no visible mark.
  const [justSigned, setJustSigned] = useState<Set<string>>(new Set());

  const bothDone = status.steps.agreements;

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:p-7">
      <div className="mb-5">
        <span className="mb-3 inline-flex size-9 items-center justify-center rounded-full bg-brand-off-white text-brand-near-black dark:bg-[#141414] dark:text-white">
          <ShieldCheck className="size-4" aria-hidden />
        </span>
        <h1 className="text-xl font-bold leading-snug text-brand-near-black dark:text-white">
          {t('contractorOnboarding.panel.agreements.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorOnboarding.panel.agreements.body')}</p>
      </div>

      <ul className="space-y-3">
        {SIGNABLE_AGREEMENTS.map(d => {
          const done = bothDone || justSigned.has(d);
          return (
            <li key={d}>
              <button
                type="button" onClick={() => { setErr(null); setOpen(d); }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                  done
                    ? 'border-state-success/40 bg-state-success/5'
                    : 'border-brand-border-grey hover:border-brand-near-black dark:border-[#444] dark:hover:border-white',
                )}
              >
                <span className={cn(
                  'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                  done ? 'bg-state-success text-white' : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#2c2c2c]',
                )}>
                  {done ? <Check className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-brand-near-black dark:text-white">
                    {t(`contractorOnboarding.doc.${d}` as TKey)}
                  </span>
                  <span className="mt-0.5 block text-xs text-brand-mid-grey">
                    {done ? t('contractorOnboarding.signedAlready') : t('contractorOnboarding.readAndSign')}
                  </span>
                </span>
                {!done && <ArrowRight className="size-4 shrink-0 text-brand-mid-grey" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>

      <Err>{err}</Err>

      {open && (
        <AgreementReader
          doc={open} busy={busy} error={err}
          onClose={() => { if (!busy) setOpen(null); }}
          onAccept={async signedName => {
            const ok = await run(() => acceptAgreement(open, signedName));
            if (ok) {
              setJustSigned(s => new Set(s).add(open));
              setOpen(null);
            }
          }}
        />
      )}
    </section>
  );
}

// ── Panel 2: you ─────────────────────────────────────────

function YouPanel({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    void fetchOnboardingRecord()
      .then(r => { setDob(r.dateOfBirth ?? ''); setAddress(r.address ?? ''); })
      .catch(() => {});
  }, []);

  return (
    <form onSubmit={e => { e.preventDefault(); void run(() => saveIdentity(dob, address)); }}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dob">{t('contractorOnboarding.dob')}</Label>
          {/* `max` is the first line — the picker will not offer a date under 18 years
              ago. save_contractor_identity refuses the same thing by name for a typed one. */}
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
            className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm dark:border-[#444] dark:bg-[#141414] dark:text-white"
          />
          <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.addressHint')}</p>
        </div>
      </div>
      <Err>{err}</Err>
      <Next busy={busy} />
    </form>
  );
}

// ── Panel 3: what they do ────────────────────────────────

function SpecialtyPanel({ onSaved }: { onSaved: (s: OnboardingStatus) => void }) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [specialty, setSpecialty] = useState<ContractorRole | ''>('');
  const [other, setOther] = useState('');
  const [license, setLicense] = useState('');

  useEffect(() => {
    void fetchOnboardingRecord().then(r => {
      if (r.specialty) setSpecialty(r.specialty as ContractorRole);
      setOther(r.specialtyOther ?? '');
      setLicense(r.licenseNumber ?? '');
    }).catch(() => {});
  }, []);

  const needsLicence = specialty ? requiresLicence(specialty) : false;
  const ready = !!specialty
    && (specialty !== 'other' || other.trim() !== '')
    && (!needsLicence || license.trim() !== '');

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!ready) return;
      void run(() => saveSpecialty({
        specialty,
        specialtyOther: specialty === 'other' ? other.trim() : null,
        // Kept when they have one even where it is not required: somebody who holds a
        // licence has told us something true.
        licenseNumber: license.trim() || null,
      }));
    }}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="specialty">{t('contractorOnboarding.specialtyLabel')}</Label>
          <select
            id="specialty" required value={specialty}
            onChange={e => setSpecialty(e.target.value as ContractorRole | '')}
            className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm text-brand-near-black dark:border-[#444] dark:bg-[#141414] dark:text-white"
          >
            <option value="">{t('contractorOnboarding.specialtyPlaceholder')}</option>
            {CONTRACTOR_ROLES.map(r => (
              <option key={r} value={r}>{t(`contractorApply.form.roles.${r}` as TKey)}</option>
            ))}
          </select>
        </div>

        {/* Only when the list did not have it. */}
        {specialty === 'other' && (
          <div className="space-y-1.5">
            <Label htmlFor="specOther">{t('contractorOnboarding.specialtyOther')}</Label>
            <Input id="specOther" required value={other} onChange={e => setOther(e.target.value)} />
            <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.specialtyOtherHint')}</p>
          </div>
        )}

        {/* Asked of the five regulated professions and nobody else (142). A mason,
            carpenter, electrician, plumber, roofer or finisher never sees this field —
            demanding it of them is what stopped an applicant registering at all. */}
        {needsLicence && (
          <div className="space-y-1.5">
            <Label htmlFor="lic">{t('contractorOnboarding.licenseNumber')}</Label>
            <Input id="lic" required value={license} onChange={e => setLicense(e.target.value)} />
            <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.licenseHint')}</p>
          </div>
        )}
      </div>
      <Err>{err}</Err>
      <Next busy={busy || !ready} />
    </form>
  );
}

// ── Panel 5: payout, which lives elsewhere ───────────────

/**
 * Payment details, taken HERE rather than at /work/payouts.
 *
 * The link-out was a real defect: it walked somebody out of a form they had not
 * finished and dropped them in the dashboard, which reads as "you are done" when they
 * are not. The dialog uses the same RPC as the payouts page, so a destination created
 * during onboarding is the same thing as one created later.
 */
function PayoutPanel({ done, onAdded }: {
  done: boolean; onAdded: () => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* No "I'll do this later" any more (142). It was also broken: choosing it left the
          step outstanding and the sequence then would not let you past the contact
          screen, so the escape hatch trapped people instead of freeing them. Payment
          details are needed before any project can pay out, so they are asked for here. */}
      <Button type="button" onClick={() => setOpen(true)}>
        {done ? t('contractorOnboarding.payoutReview') : t('contractorOnboarding.payoutCta')}
      </Button>

      {open && (
        <PayoutDialog
          onClose={() => setOpen(false)}
          onSaved={async () => { setOpen(false); await onAdded(); }}
        />
      )}
    </div>
  );
}

// ── Panels 6–8: one emergency contact each ───────────────

function ContactPanel({ contacts, setContacts, onSaved }: {
  contacts: EmergencyContact[];
  setContacts: React.Dispatch<React.SetStateAction<EmergencyContact[]>>;
  onSaved: (s: OnboardingStatus) => void;
}) {
  const t = useT();
  const { busy, err, run } = useSave(onSaved);
  const [local, setLocal] = useState<string | null>(null);
  const c = contacts[0];

  const set = (patch: Partial<EmergencyContact>) =>
    setContacts(rs => rs.map((r, k) => (k === 0 ? { ...r, ...patch } : r)));

  const submit = () => {
    // PhoneField already emits E.164 for the country they picked. It is still checked
    // here, because normalisePhone passes a number through unchanged when it cannot
    // place it — "it returned something" is not "this is dialable".
    const phone = c.phone.trim();
    if (!isE164(phone)) { setLocal(t('contractorOnboarding.err.badPhone', { n: '1' })); return; }
    setLocal(null);
    // One contact, saved on its own (142). Three used to be collected across three
    // screens and sent together, so walking away after the first lost that typing.
    void run(() => saveEmergencyContacts([{ ...c, phone }]));
  };

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cn1">{t('contractorOnboarding.contactName')}</Label>
          <Input id="cn1" required value={c.fullName} onChange={e => set({ fullName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr1">{t('contractorOnboarding.contactRelationship')}</Label>
          <Input id="cr1" required value={c.relationship} onChange={e => set({ relationship: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp1">{t('contractorOnboarding.contactPhone')}</Label>
          {/* The full dialling list, not the build-country list: a contractor's next of
              kin is often not in the country they build in. */}
          <PhoneField id="cp1" required value={c.phone} onChange={phone => set({ phone })} />
          <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.phoneHint')}</p>
        </div>
        <p className="text-xs text-brand-mid-grey">{t('contractorOnboarding.contactMoreLater')}</p>
      </div>
      <Err>{local ?? err}</Err>
      <Next busy={busy} />
    </form>
  );
}

