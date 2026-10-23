import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  loadPartnerPrefill, myApplicationSummary, submitPartnerApplication,
  type ApplicationState, type PartnerPrefill,
} from '@/lib/supabase/partner-application';
import {
  disqualifiedBy, qualifiesForCall,
  type Disqualifier, type GroundworkUse, type ProjectStatus,
} from '@/lib/contractor/partner-qualification';
import { bookingUrl, needsVanessa, markBookingShown } from '@/lib/supabase/partner-booking';
import {
  partnerDraftId, clearPartnerDraftId, markPartnerDraftSubmitted, saveApplicationDraft,
} from '@/lib/supabase/application-drafts';
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

/**
 * The sub-answers behind Philip's branching questions.
 *
 * The stages reuse the dictionary's own `stages.*` keys rather than a second list of
 * stage names: a partner describing where their build has reached should be choosing
 * from the same vocabulary the product will then track it in.
 */
const PROJECT_STATUS = ['running', 'starting', 'none'] as const;
/** The applicant's own words for where a build has reached, not the tracked stage list.
 *  Somebody describing a project they have not put into Groundwork yet is estimating,
 *  and "half way through" is an answer they can give honestly. */
const PROJECT_STAGES = ['design', 'just_started', 'half_way', 'almost_done', 'at_finishing'] as const;
const START_WINDOWS = ['under_month', '1_3_months', '3_6_months', '6_months_plus'] as const;
const OFFSITE_REASONS = [
  'very_busy', 'live_far', 'different_region', 'different_country', 'other',
] as const;
const GROUNDWORK_USE = ['yes', 'maybe', 'no'] as const;

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
  const [years, setYears] = useState('');
  const [operatesAs, setOperatesAs] = useState('');
  const [capacity, setCapacity] = useState('');
  const [regions, setRegions] = useState('');
  const [history, setHistory] = useState('');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [projectStage, setProjectStage] = useState('');
  const [startWindow, setStartWindow] = useState('');
  const [clientOnSiteDaily, setClientOnSiteDaily] = useState<boolean | null>(null);
  const [offsiteReason, setOffsiteReason] = useState('');
  const [offsiteOther, setOffsiteOther] = useState('');
  const [useGroundwork, setUseGroundwork] = useState<GroundworkUse | null>(null);
  /**
   * The rule that ended it, once one has.
   *
   * Philip: "if a question that they answer disqualifies them then they should not see
   * the remaining steps." So this is not a warning rendered beside the form — setting
   * it replaces the form entirely.
   */
  const [stopped, setStopped] = useState<Disqualifier | null>(null);
  const [whyJoin, setWhyJoin] = useState('');
  const [differentiator, setDifferentiator] = useState('');
  /** Which of the three pages they are on. */
  const [page, setPage] = useState(0);

  /**
   * Open the calendar, and record that we did.
   *
   * The single way `booking` is ever set to a URL, so the funnel's `sent_to_booking`
   * cannot drift from what the applicant was actually shown.
   */
  const openBooking = useCallback(async (preferredLanguage: string) => {
    // Which calendar depends on the language they asked to be spoken to in: Philip
    // hosts both, Vanessa co-hosts the French one. A co-host sits on the schedule
    // rather than on a booking, so this is the only way to put her in the right room.
    const url = await bookingUrl(preferredLanguage);
    setBooking(url);
    // Only when a real slot was shown. An unconfigured schedule is not a booking step
    // they reached — it is one we failed to offer, and counting it would hide that.
    if (url) void markBookingShown();
  }, []);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void Promise.all([loadPartnerPrefill(user.id), myApplicationSummary(user.id)])
      .then(([p, summary]) => {
        if (!live) return;
        setPrefill(p);
        setState(summary.state);
        // Coming back to a qualified application that is already in the queue: show the
        // calendar again. Without this, closing the tab before booking was a dead end —
        // the status card rendered with nothing under it and no way to reach a slot.
        const inQueue = summary.state === 'pending' || summary.state === 'reviewing'
                     || summary.state === 'accepted';
        // Their stored answer, not this page's empty state: somebody returning to a
        // pending application has not re-answered anything yet.
        if (inQueue && summary.decisionReady) void openBooking(summary.language);
      })
      .catch(() => { if (live) setState('none'); });
    return () => { live = false; };
  }, [user, openBooking]);

  /**
   * Who started this application and did not finish.
   *
   * The public form has had this since 043; the partner application had nothing, so
   * somebody who got five questions in and stopped left no trace and nobody to chase.
   * Written with `source: 'in_app'` so /admin/drafts can tell a half-finished PARTNER
   * application from a half-finished contractor one — a different person needing a
   * different follow-up.
   */
  const answered = [callLang, years, operatesAs, capacity,
    regions.trim(), history.trim(), whyJoin.trim(), differentiator.trim()]
    .filter(Boolean).length
    + (projectStatus !== null ? 1 : 0)
    + (clientOnSiteDaily !== null ? 1 : 0)
    + (useGroundwork !== null ? 1 : 0);
  const progressPct = Math.round((100 * answered) / 11);
  const draftState = JSON.stringify([callLang, years, operatesAs, capacity,
    regions, history, whyJoin, differentiator, projectStatus, projectStage, startWindow,
    clientOnSiteDaily, offsiteReason, offsiteOther, useGroundwork]);

  useEffect(() => {
    // Nothing answered yet means they only opened the page. Writing then would put every
    // partner who said "yes" at onboarding onto the follow-up list before they had done
    // anything, which is exactly the signal the list is supposed to carry.
    if (!user || !prefill || state !== 'none' || answered === 0) return;
    const timer = setTimeout(() => {
      void saveApplicationDraft(partnerDraftId(user.id), {
        source: 'in_app',
        userId: user.id,
        fullName: prefill.fullName ?? undefined,
        email: prefill.email ?? undefined,
        phone: prefill.phone ?? undefined,
        role: prefill?.specialty ?? undefined,
        payload: {
          languages: callLang ? [callLang] : [], years, operatesAs,
          capacity, regions: regions.trim(), diasporaHistory: history.trim(),
          whyJoin: whyJoin.trim(), differentiator: differentiator.trim(),
          projectStatus, projectStage, startWindow,
          clientOnSiteDaily, offsiteReason, offsiteOther, useGroundwork,
        },
        progressPct,
      });
    }, 2_000);
    return () => clearTimeout(timer);
    // `draftState` stands in for every answer above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftState, user?.id, prefill, state]);

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
            {/* What this says has to match what is actually under it. The page used to
                promise a call somebody would arrange, on a screen that was already
                showing the calendar; correcting that for the qualifying case left the
                opposite contradiction — "book below" to an applicant who does not
                qualify and is shown no calendar at all. So the line follows the frame. */}
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
              {t(state === 'accepted' ? 'partner.statusAcceptedBody'
                 : booking ? 'partner.statusPendingBook'
                 : 'partner.statusPendingBody')}
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

  /** Everything the rules look at, in one object so the form and the module agree. */
  const answers = {
    yearsExperience: years, projectStatus, clientOnSiteDaily,
    willUseGroundwork: useGroundwork,
  };
  const ready = qualifiesForCall(answers);

  /**
   * Three pages, not one long form and not one question at a time.
   *
   * The whole form at once made the application feel like a different exercise from the
   * onboarding people had just come through, and it was easy to abandon. A single
   * question per screen would be nine screens for a short application. Three pages of
   * three keeps the sense of moving forward without making it a slog.
   */
  const PAGES = 4;
  const pageReady = (n: number): boolean => {
    if (n === 0) return !!callLang && !!years && !!operatesAs;
    if (n === 1) return regions.trim() !== '' && !!capacity;
    if (n === 2) {
      /**
       * A disqualifying answer completes this page by itself.
       *
       * Found by driving the form: choosing "No, I don't have a project" left Next
       * disabled, because the page still wanted the two questions underneath it — so
       * somebody already out had to answer two more before anything would happen. That
       * is the opposite of "they should not see the remaining steps", and it is a dead
       * end for anyone who reads the first question honestly and stops.
       *
       * Pressing Next is still what ends it, so a chip tapped by mistake can be
       * changed; what this removes is being unable to press Next at all.
       */
      if (disqualifiedBy(answers)) return true;

      // A parent question is not answered until its sub-question is. The table refuses
      // a stage against a project that has not started (152); this refuses the Next.
      const projectDone =
        projectStatus === 'none' ? true
        : projectStatus === 'running' ? !!projectStage
        : projectStatus === 'starting' ? !!startWindow
        : false;
      const onSiteDone =
        clientOnSiteDaily === true ? true
        : clientOnSiteDaily === false
          ? !!offsiteReason && (offsiteReason !== 'other' || offsiteOther.trim() !== '')
          : false;
      return projectDone && onSiteDone && useGroundwork !== null;
    }
    return whyJoin.trim() !== '' && differentiator.trim() !== '';
  };

  const complete = !!callLang && years && operatesAs && capacity && regions.trim()
    && whyJoin.trim() && differentiator.trim()
    && projectStatus !== null && clientOnSiteDaily !== null && useGroundwork !== null;

  /**
   * Move on — or end it here.
   *
   * The check runs on Next rather than on each answer so somebody can change their mind
   * about a chip they just tapped without the page vanishing under them. Everything
   * answered so far is tested, so the rule that fires is the one on the page they are
   * leaving.
   */
  async function advance() {
    const reason = disqualifiedBy(answers);
    if (reason) { await stopHere(reason); return; }
    setPage(p => p + 1);
  }

  /**
   * File the application as disqualified, and show them why.
   *
   * Recorded rather than discarded: this is where the funnel loses people, which is the
   * thing the numbers are for. 133's unique index treats only pending, reviewing and
   * accepted as live, so this never blocks a fresh application when their situation
   * changes — which for "no project yet" is a matter of time.
   */
  async function stopHere(reason: Disqualifier) {
    setStopped(reason);
    if (!user || !prefill) return;
    setBusy(true);
    try {
      const applicationId = await submitPartnerApplication(user.id, prefill, {
        languages: callLang ? [callLang] : [], diasporaHistory: history.trim(),
        hasCurrentProject: projectStatus != null && projectStatus !== 'none',
        whyJoin: whyJoin.trim(), differentiator: differentiator.trim(),
        regions: regions.trim(), concurrentProjects: capacity, yearsExperience: years,
        role: prefill.specialty ?? '', operatesAs, city: '',
        projectStatus, projectStage, projectStartWindow: startWindow,
        clientOnSiteDaily, clientOffsiteReason: offsiteReason,
        clientOffsiteReasonOther: offsiteOther.trim(),
        willUseGroundwork: useGroundwork, disqualifiedReason: reason,
      });
      if (applicationId) void markPartnerDraftSubmitted(applicationId);
      clearPartnerDraftId(user.id);
    } catch {
      // Their application ended either way; a failed write must not turn that into an
      // error screen asking them to try again.
    } finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !prefill || !complete) return;
    setBusy(true); setError(null);
    try {
      const applicationId = await submitPartnerApplication(user.id, prefill, {
        languages: [callLang], diasporaHistory: history.trim(),
        // Kept in step with `projectStatus` so the funnel board's own pre-qualified
        // rule, which reads this column, does not go blind the day the form changed.
        hasCurrentProject: projectStatus != null && projectStatus !== 'none',
        whyJoin: whyJoin.trim(), differentiator: differentiator.trim(),
        regions: regions.trim(), concurrentProjects: capacity,
        yearsExperience: years,
        projectStatus, projectStage, projectStartWindow: startWindow,
        clientOnSiteDaily, clientOffsiteReason: offsiteReason,
        clientOffsiteReasonOther: offsiteOther.trim(),
        willUseGroundwork: useGroundwork, disqualifiedReason: null,
        // Both come from onboarding now (142): the specialty was asked there, and the
        // address it had already taken is what "city you work from" was reaching for.
        role: prefill.specialty ?? '', operatesAs, city: '',
      });
      setState('pending');
      // They finished, so take them off the follow-up list. By user rather than by draft
      // id: starting on a phone and finishing on a laptop leaves a row this browser has
      // never heard of, and chasing somebody who already applied is worse than not
      // chasing at all.
      if (applicationId) void markPartnerDraftSubmitted(applicationId);
      clearPartnerDraftId(user.id);
      // Only a decision-ready applicant is offered the calendar. Philip's time is the
      // constraint — 18 calls, 4 qualified — so a call is booked by somebody with a
      // live project they will introduce, and nobody else.
      if (ready) await openBooking(callLang);

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
  // text-base below sm so iOS does not zoom the page on focus; see ui/input.tsx.
  const field = 'w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white';

  /**
   * The application ended here.
   *
   * Philip: "The application gets discontinued for them. We just redirect them to a
   * thank you page... the method should still be calming marketing, so they don't get
   * pissed off and feel like you're not good enough."
   *
   * So each reason says what Groundwork is for rather than what they lack, and every
   * one of them ends on a door that is still open: two of the three are a matter of
   * circumstance, and circumstance changes. The dashboard stays theirs either way.
   */
  if (stopped) {
    return (
      <div className="max-w-xl space-y-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-brand-near-black dark:text-white">
          <ShieldCheck className="size-5" />{t('partner.title')}
        </h1>
        <div className="flex items-start gap-3 rounded-2xl border border-brand-border-grey p-5 dark:border-[#2c2c2c]">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-complete" />
          <div>
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t('partner.stopped.title')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
              {t(`partner.stopped.${stopped}` as never)}
            </p>
          </div>
        </div>
        <Link to="/work"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black">
          {t('partner.stopped.dashboard')}
        </Link>
      </div>
    );
  }

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

      {/* Where they are, so three pages read as progress rather than as more forms. */}
      <div className="flex gap-1" role="progressbar" aria-valuenow={page + 1} aria-valuemin={1} aria-valuemax={PAGES}>
        {Array.from({ length: PAGES }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors',
            i < page ? 'bg-state-success'
            : i === page ? 'bg-brand-near-black dark:bg-white'
            : 'bg-brand-border-grey dark:bg-[#2c2c2c]')} />
        ))}
      </div>

      {page === 0 && (
        <>
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
        </>
      )}

      {page === 1 && (
        <>
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
        </>
      )}

      {/* The three that decide it. A parent question opens its own sub-question and
          nothing else, which is the shape Philip described: "this is a parent question
          and after this parent question, depending on either one of these answers,
          it then has a sub question within that with its own options." */}
      {page === 2 && (
        <>
          <div className="space-y-3 rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
            <Choice label={t('partner.projectStatus')} options={PROJECT_STATUS}
              value={projectStatus} tKey="partner.projectStatusOpt" chip={chip}
              onChange={v => {
                setProjectStatus(v as ProjectStatus);
                // The sub-answer belongs to one parent only; 152 refuses the other
                // combination outright, so the form must not keep a stale one.
                setProjectStage(''); setStartWindow('');
              }} />

            {projectStatus === 'running' && (
              <Choice label={t('partner.projectStage')} options={PROJECT_STAGES}
                value={projectStage} tKey="partner.stageOpt" chip={chip} onChange={setProjectStage} />
            )}
            {projectStatus === 'starting' && (
              <Choice label={t('partner.startWindow')} options={START_WINDOWS}
                value={startWindow} tKey="partner.startOpt" chip={chip} onChange={setStartWindow} />
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
            <YesNo label={t('partner.clientOnSite')} value={clientOnSiteDaily}
              onChange={v => { setClientOnSiteDaily(v); if (v) { setOffsiteReason(''); setOffsiteOther(''); } }}
              chip={chip} />
            {clientOnSiteDaily === false && (
              <>
                <Choice label={t('partner.offsiteReason')} options={OFFSITE_REASONS}
                  value={offsiteReason} tKey="partner.offsiteOpt" chip={chip} onChange={setOffsiteReason} />
                {offsiteReason === 'other' && (
                  <input value={offsiteOther} onChange={e => setOffsiteOther(e.target.value)}
                    className={field} placeholder={t('partner.offsiteOtherPlaceholder')} />
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
            <Choice label={t('partner.useGroundwork')} options={GROUNDWORK_USE}
              value={useGroundwork} tKey="partner.useOpt" chip={chip}
              onChange={v => setUseGroundwork(v as GroundworkUse)} stacked />
          </div>
        </>
      )}

      {page === 3 && (
        <>
          <Row label={t('partner.whyJoin')}>
            <textarea rows={3} value={whyJoin} onChange={e => setWhyJoin(e.target.value)} className={field} />
          </Row>

          <Row label={t('partner.differentiator')}>
            <textarea rows={3} value={differentiator} onChange={e => setDifferentiator(e.target.value)} className={field} />
          </Row>
        </>
      )}

      {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}

      <div className="flex items-center gap-3">
        {page > 0 && (
          <button type="button" onClick={() => setPage(p => p - 1)}
            className="text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
            {t('common.back')}
          </button>
        )}
        {page < PAGES - 1 ? (
          // A plain button, never a submit: Enter on a text field would otherwise file a
          // half-finished application from page one.
          <button type="button" disabled={!pageReady(page) || busy} onClick={() => void advance()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black">
            {t('common.next')}
          </button>
        ) : (
          <button type="submit" disabled={busy || !complete}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('partner.submit')}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * A row of chips over a fixed list of options.
 *
 * One component rather than five copies of the same map, so a sub-question cannot drift
 * from its parent in how it looks or how it reads to a screen reader.
 */
function Choice({ label, options, value, tKey, chip, onChange, stacked }: {
  label: string; options: readonly string[]; value: string | null; tKey: string;
  chip: (on: boolean) => string; onChange: (v: string) => void; stacked?: boolean;
}) {
  const t = useT();
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      <div className={cn('flex gap-2', stacked ? 'flex-col items-start' : 'flex-wrap')}>
        {options.map(o => (
          <button key={o} type="button" className={chip(value === o)} onClick={() => onChange(o)}>
            {t(`${tKey}.${o}` as never)}
          </button>
        ))}
      </div>
    </div>
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
