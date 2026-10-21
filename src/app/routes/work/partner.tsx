import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  loadPartnerPrefill, myApplicationState, submitPartnerApplication, isDecisionReady,
  type ApplicationState, type PartnerPrefill,
} from '@/lib/supabase/partner-application';
import { bookingUrl, needsVanessa } from '@/lib/supabase/partner-booking';
import { notifyAdmins } from '@/lib/supabase/notifications';

/**
 * Apply to the Jalla partner network, from inside Groundwork.
 *
 * ── The step the funnel was missing ─────────────────────────────────────────────────
 * The new sequence is signup → onboarding → PARTNER APPLICATION → one qualifying call →
 * client introduction → activation. The application existed only on the public
 * marketing page, so a professional who had already signed up and onboarded had no way
 * to ask for the partner pathway at all.
 *
 * ── It asks what we do not already know, and nothing else ───────────────────────────
 * Name, email, phone, country, business name, registration and licence are all on file
 * by this point. Asking again is the friction that cost us three of four qualified
 * professionals, so the form is six questions, two of which decide everything.
 */

const LANGS = ['en', 'fr'] as const;
const YEARS = ['1-3', '3-5', '5-10', '10+'] as const;
const OPERATES = ['solo', 'company'] as const;
const CAPACITY = ['1', '2', '3', '4+'] as const;

export default function PartnerApplication() {
  const t = useT();
  const { user } = useAuth();
  const [prefill, setPrefill] = useState<PartnerPrefill | null>(null);
  const [state, setState] = useState<ApplicationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The booking frame, once a qualified application is in.
   *
   * Shown on this same page rather than as a separate step: "calls booked" is the last
   * stage of the funnel and every extra navigation is somewhere to drop out. A
   * qualified applicant sees the calendar the moment they submit.
   */
  const [booking, setBooking] = useState<string | null | 'unset'>('unset');

  /** The language they want to be contacted in. One answer, because it routes the
   *  call and a multi-select left 'both' to be guessed at. */
  const [callLang, setCallLang] = useState('');
  const [role, setRole] = useState('');
  const [city, setCity] = useState('');
  const [years, setYears] = useState('');
  const [operatesAs, setOperatesAs] = useState('');
  const [capacity, setCapacity] = useState('');
  const [regions, setRegions] = useState('');
  const [history, setHistory] = useState('');
  const [hasProject, setHasProject] = useState<boolean | null>(null);
  const [willIntroduce, setWillIntroduce] = useState<boolean | null>(null);
  const [whyJoin, setWhyJoin] = useState('');
  const [differentiator, setDifferentiator] = useState('');

  useEffect(() => {
    if (!user) return;
    let live = true;
    void Promise.all([loadPartnerPrefill(user.id), myApplicationState(user.id)])
      .then(([p, s]) => { if (live) { setPrefill(p); setState(s); if (p) setCity(''); } })
      .catch(() => { if (live) setState('none'); });
    return () => { live = false; };
  }, [user]);

  if (!user || state === null) {
    return <p role="status" className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }

  // Already in the queue. Showing the form again would let somebody file twice and land
  // in Ruth's review list as two people.
  if (state !== 'none' && state !== 'rejected' && state !== 'disqualified') {
    return (
      <div className="max-w-xl space-y-3">
        <h1 className="text-xl font-semibold text-brand-near-black dark:text-white">{t('partner.title')}</h1>
        <div className="flex items-start gap-3 rounded-2xl border border-brand-border-grey p-5 dark:border-[#2c2c2c]">
          {state === 'accepted'
            ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-complete" />
            : <Clock className="mt-0.5 size-5 shrink-0 text-brand-mid-grey" />}
          <div>
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t(state === 'accepted' ? 'partner.statusAcceptedTitle' : 'partner.statusPendingTitle')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
              {t(state === 'accepted' ? 'partner.statusAcceptedBody' : 'partner.statusPendingBody')}
            </p>
          </div>
        </div>

        {booking !== 'unset' && (
          booking ? (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-brand-near-black dark:text-white">
                {t('partner.bookTitle')}
              </h2>
              <p className="mb-2 text-xs text-brand-mid-grey">{t('partner.bookBody')}</p>
              <iframe
                src={booking} title={t('partner.bookTitle')}
                className="h-[600px] w-full rounded-xl border border-brand-border-grey dark:border-[#2c2c2c]"
              />
            </div>
          ) : (
            // No schedule configured yet. Said plainly — an empty frame reads as broken,
            // and this way the applicant still knows what happens next.
            <p className="rounded-xl border border-brand-border-grey p-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c]">
              {t('partner.bookUnavailable')}
            </p>
          )
        )}
        <Link to="/work" className="inline-block text-xs underline">{t('contractor.nav.dashboard')}</Link>
      </div>
    );
  }

  const ready = hasProject !== null && willIntroduce !== null
    && isDecisionReady({ hasCurrentProject: hasProject, willIntroduce });
  const complete = !!callLang && role.trim() && city.trim() && years && operatesAs
    && capacity && regions.trim() && whyJoin.trim() && differentiator.trim()
    && hasProject !== null && willIntroduce !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !prefill || !complete) return;
    setBusy(true); setError(null);
    try {
      await submitPartnerApplication(user.id, prefill, {
        languages: [callLang], diasporaHistory: history.trim(),
        hasCurrentProject: hasProject === true, willIntroduce: willIntroduce === true,
        whyJoin: whyJoin.trim(), differentiator: differentiator.trim(),
        regions: regions.trim(), concurrentProjects: capacity,
        yearsExperience: years, role: role.trim(), operatesAs, city: city.trim(),
      });
      setState('pending');
      // Only a decision-ready applicant is offered the calendar. Philip's time is the
      // constraint — 18 calls, 4 qualified — so a call is booked by somebody with a
      // live project they will introduce, and nobody else.
      if (ready) setBooking(await bookingUrl());

      /**
       * A French applicant means Vanessa is needed in the room.
       *
       * Google cannot add a guest per booking — co-hosts sit on the schedule and apply
       * to every slot — so the invitation is ours to send. Without this nobody learns
       * the call needs her until it is happening in a language the host cannot hold.
       *
       * After the application is saved and never in its way: a notification that fails
       * must not lose somebody's application.
       */
      if (needsVanessa(callLang)) {
        void notifyAdmins(
          'partner_application',
          'French-speaking partner applicant — Vanessa should join',
          `${prefill?.fullName ?? 'An applicant'} applied to the partner network and asked to be `
            + `spoken to in French.${ready ? ' They are booking a call now.' : ''}`,
          { preferred_language: 'fr', decision_ready: ready },
        ).catch(() => {});
      }
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally { setBusy(false); }
  }

  const chip = (on: boolean) => cn(
    'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
    on ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
       : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]');
  const field = 'w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white';

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-brand-near-black dark:text-white">
          <ShieldCheck className="size-5" />{t('partner.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('partner.sub')}</p>
      </div>

      {/* What we already hold. Shown, not asked — the point of applying from inside. */}
      {prefill && (
        <div className="rounded-xl bg-brand-off-white px-4 py-3 text-xs text-brand-mid-grey dark:bg-[#2c2c2c]">
          <span className="font-semibold text-brand-near-black dark:text-white">{prefill.fullName}</span>
          {prefill.businessName && ` · ${prefill.businessName}`} · {prefill.email}
          <span className="mt-1 block">{t('partner.onFile')}</span>
        </div>
      )}

      <Row label={t('partner.languages')} hint={t('partner.languagesHint')}>
        <div className="flex gap-2">
          {LANGS.map(l => (
            <button key={l} type="button" className={chip(callLang === l)}
              onClick={() => setCallLang(l)}>
              {t(`partner.lang.${l}` as never)}
            </button>
          ))}
        </div>
      </Row>

      <Row label={t('partner.role')}>
        <input value={role} onChange={e => setRole(e.target.value)} className={field}
          placeholder={t('partner.rolePlaceholder')} />
      </Row>

      <Row label={t('partner.city')}>
        <input value={city} onChange={e => setCity(e.target.value)} className={field} />
      </Row>

      <Row label={t('partner.years')}>
        <div className="flex flex-wrap gap-2">
          {YEARS.map(y => <button key={y} type="button" className={chip(years === y)}
            onClick={() => setYears(y)}>{y}</button>)}
        </div>
      </Row>

      <Row label={t('partner.operatesAs')}>
        <div className="flex gap-2">
          {OPERATES.map(o => <button key={o} type="button" className={chip(operatesAs === o)}
            onClick={() => setOperatesAs(o)}>{t(`partner.operates.${o}` as never)}</button>)}
        </div>
      </Row>

      <Row label={t('partner.regions')}>
        <input value={regions} onChange={e => setRegions(e.target.value)} className={field}
          placeholder={t('partner.regionsPlaceholder')} />
      </Row>

      <Row label={t('partner.capacity')}>
        <div className="flex gap-2">
          {CAPACITY.map(c => <button key={c} type="button" className={chip(capacity === c)}
            onClick={() => setCapacity(c)}>{c}</button>)}
        </div>
      </Row>

      <Row label={t('partner.history')} hint={t('partner.historyHint')}>
        <textarea rows={2} value={history} onChange={e => setHistory(e.target.value)} className={field} />
      </Row>

      {/* The two that decide whether this reaches a calendar. */}
      <div className="rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
        <YesNo label={t('partner.hasProject')} value={hasProject} onChange={setHasProject} chip={chip} />
        <div className="mt-4">
          <YesNo label={t('partner.willIntroduce')} value={willIntroduce} onChange={setWillIntroduce} chip={chip} />
        </div>
        {/* Said plainly rather than silently de-prioritising them: somebody without a
            project today is welcome on Groundwork and can apply again when they have one. */}
        {hasProject !== null && willIntroduce !== null && !ready && (
          <p className="mt-3 text-xs text-brand-mid-grey">{t('partner.notReadyNote')}</p>
        )}
      </div>

      <Row label={t('partner.whyJoin')}>
        <textarea rows={2} value={whyJoin} onChange={e => setWhyJoin(e.target.value)} className={field} />
      </Row>

      <Row label={t('partner.differentiator')}>
        <textarea rows={2} value={differentiator} onChange={e => setDifferentiator(e.target.value)} className={field} />
      </Row>

      {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}

      <button type="submit" disabled={busy || !complete}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t('partner.submit')}
      </button>
    </form>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      {hint && <span className="mb-1.5 block text-[11px] text-brand-mid-grey">{hint}</span>}
      {children}
    </label>
  );
}

function YesNo({ label, value, onChange, chip }: {
  label: string; value: boolean | null; onChange: (v: boolean) => void; chip: (on: boolean) => string;
}) {
  const t = useT();
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      <div className="flex gap-2">
        <button type="button" className={chip(value === true)} onClick={() => onChange(true)}>{t('common.yes')}</button>
        <button type="button" className={chip(value === false)} onClick={() => onChange(false)}>{t('common.no')}</button>
      </div>
    </div>
  );
}
