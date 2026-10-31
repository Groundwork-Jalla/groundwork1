import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';
import { trackFunnel } from '@/lib/analytics/funnel';
import { partnerTrack } from '@/lib/contractor/partner-track';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import {
  loadPartnerPrefill, myApplicationSummary, myApplicationDetail, submitPartnerApplication,
  type ApplicationState, type PartnerPrefill, type PartnerApplicationDetail,
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

/**
 * Postgres 23505 against the one-live-application index.
 *
 * Matched on the SQLSTATE and the constraint name rather than on the message text,
 * which is not ours and is not translated.
 */
function isDuplicateApplication(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  return e.code === '23505' || /one_per_account/.test(message);
}

/**
 * What an applicant is allowed to be shown when a submit fails.
 *
 * `errorMessage` deliberately surfaces the raw PostgREST text — message, details, hint
 * and code — because that is what makes a 400 debuggable. On this page it is the wrong
 * audience: Ruth submitted on 31 Oct 2026 and was shown
 *
 *   new row for relation "contractor_applications" violates check constraint
 *   "contractor_applications_role_other_required" (23514)
 *
 * which names a table, a constraint and a Postgres error class, and tells her nothing
 * she can do. Philip had already met the 23505 version of this on a live call.
 *
 * So a database-level refusal becomes one plain sentence, and the raw error goes to the
 * console where it is still there for whoever is debugging. Anything that is NOT a
 * database constraint — a network failure, a thrown Error with a written message — is
 * passed through as before, because those are usually worth reading.
 */
function applicantError(err: unknown, fallback: string, namedTrade: string): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';

  // The one constraint an applicant can clear themselves. It only fires for somebody
  // whose onboarding trade is "other" with nothing typed beside it — onboarding
  // requires that today, so in practice only an older account reaches it. Telling
  // them which field to fix beats a generic "try again" they cannot act on.
  if (/role_other_required/.test(message)) {
    console.error('[partner] application refused: role is "other" with no trade named', err);
    return namedTrade;
  }

  // 23xxx is Postgres' integrity-constraint class: not null, foreign key, unique, check.
  if (/^23\d\d\d$/.test(code)) {
    console.error('[partner] application refused by the database:', err);
    return fallback;
  }
  return errorMessage(err, fallback);
}

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
  // Asked as yes/no (27 Oct). The description is only meaningful on a yes, and a free
  // text box as the whole question made "no" look like "not answered yet".
  const [workedDiaspora, setWorkedDiaspora] = useState<boolean | null>(null);
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
  /** Whether their stored answers qualify. Kept so the funnel track can show it. */
  const [qualified, setQualified] = useState(false);
  /** Their filed answers, for showing back to them. Null until read, or unreadable. */
  const [detail, setDetail] = useState<PartnerApplicationDetail | null>(null);
  const [whyJoin, setWhyJoin] = useState('');
  const [differentiator, setDifferentiator] = useState('');
  /** Current question and route history (some questions are conditional). */
  const [page, setPage] = useState(0);
  const [pageStack, setPageStack] = useState<number[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

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
    if (url) {
      void markBookingShown();
      // The calendar was actually shown. The END of this sequence lives in Philip's
      // calendar, not here — the widget is a cross-origin iframe, so Groundwork can
      // see that a slot was offered and never that one was taken. That gap is the
      // finding, and it is not papered over by recording a completion we cannot see.
      trackFunnel('call_booking', 'started');
    }
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
        setQualified(summary.decisionReady);
        if (inQueue) void myApplicationDetail(user.id).then(d => { if (live) setDetail(d); }).catch(() => {});
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
    regions.trim(), whyJoin.trim(), differentiator.trim()]
    .filter(Boolean).length
    + (workedDiaspora !== null ? 1 : 0)
    + (projectStatus !== null ? 1 : 0)
    + (clientOnSiteDaily !== null ? 1 : 0)
    + (useGroundwork !== null ? 1 : 0);
  const progressPct = Math.round((100 * answered) / 11);
  const draftState = JSON.stringify([callLang, years, operatesAs, capacity,
    regions, workedDiaspora, history, whyJoin, differentiator, projectStatus, projectStage, startWindow,
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

  /**
   * Scroll the form back to the top as the questions advance.
   *
   * Declared HERE, above the early returns below, and not beside the `page` state it
   * watches. It used to sit further down the component, after `if (state === null)`
   * and `if (state !== 'none')` had already returned — so the first render (state
   * still loading) ran fewer hooks than the second, and React threw "Rendered more
   * hooks than during the previous render". That took out the whole page for anyone
   * who had not applied yet, which is everybody the funnel is for.
   */
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  if (!user || state === null) {
    return <p role="status" className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }

  /** Everything the rules look at, in one object so the form and the module agree. */
  const answers = {
    yearsExperience: years, projectStatus, clientOnSiteDaily,
    willUseGroundwork: useGroundwork,
  };
  const ready = qualifiesForCall(answers);

  /** One question per screen, each confirmed with Next. */
  const PAGES = 15;

  const complete = !!callLang && years && operatesAs && capacity && regions.trim()
    && whyJoin.trim() && differentiator.trim()
    && projectStatus !== null && clientOnSiteDaily !== null && useGroundwork !== null;

  function continueTo(nextPage: number) {
    // The partner application has BEGUN. Philip, 30 Oct 2026: it starts when they
    // press Next on the partner page having chosen a language — which is this, on
    // the first page. Recorded here and not inferred from the onboarding answer:
    // reading "I have a project" as the start of an application is what made one
    // click end one sequence and begin another. The RPC keeps the first occurrence,
    // so calling it on every Next cannot inflate the count.
    trackFunnel('partner_application', 'started');
    setPageStack(stack => [...stack, page]);
    setPage(nextPage);
  }

  function goBack() {
    const previous = pageStack.at(-1);
    if (previous === undefined) return;
    setPageStack(stack => stack.slice(0, -1));
    setPage(previous);
  }

  // ── Answer, then press Next ──────────────────────────────────────────────────
  //
  // Philip, 30 October: "after each question is answered, the next one has the next
  // button that they can click to get to the next stage." Until now a tap on a chip
  // jumped straight to the following question, which read as the form snatching the
  // page away — and on the free-text questions the jump fired on BLUR, so clicking
  // anywhere outside the box advanced it.
  //
  // Selection now only selects. These two decide whether Next is offered and where
  // it goes, and they are the single place the branching lives.

  /** Whether the question on screen has been answered. */
  function isAnswered(at: number): boolean {
    switch (at) {
      case 0:  return callLang !== '';
      case 1:  return years !== '';
      case 2:  return operatesAs !== '';
      case 3:  return regions.trim() !== '';
      case 4:  return capacity !== '';
      case 5:  return workedDiaspora !== null;
      case 6:  return history.trim() !== '';
      case 7:  return projectStatus !== null;
      case 8:  return projectStatus === 'running' ? projectStage !== '' : startWindow !== '';
      case 9:  return clientOnSiteDaily !== null;
      case 10: return offsiteReason !== '';
      case 11: return offsiteOther.trim() !== '';
      case 12: return useGroundwork !== null;
      case 13: return whyJoin.trim() !== '';
      case 14: return differentiator.trim() !== '';
      default: return false;
    }
  }

  /**
   * Where Next goes from here — or which rule ends the application.
   *
   * The three disqualifiers used to fire the moment a chip was tapped. They fire on
   * Next instead, so an answer can be changed before it is committed; the rules
   * themselves are unchanged and `stopHere` still writes the row.
   */
  function advance() {
    switch (page) {
      case 5:  return continueTo(workedDiaspora ? 6 : 7);
      case 7:
        if (projectStatus === 'none') {
          return void stopHere('no_project', { projectStatus });
        }
        return continueTo(8);
      case 9:
        if (clientOnSiteDaily) {
          return void stopHere('client_on_site_daily', { clientOnSiteDaily });
        }
        return continueTo(10);
      case 10: return continueTo(offsiteReason === 'other' ? 11 : 12);
      case 12:
        if (useGroundwork === 'no') {
          return void stopHere('not_using_groundwork', { willUseGroundwork: useGroundwork });
        }
        return continueTo(13);
      default: return continueTo(page + 1);
    }
  }

  /**
   * File the application as disqualified, and show them why.
   *
   * Recorded rather than discarded: this is where the funnel loses people, which is the
   * thing the numbers are for. 133's unique index treats only pending, reviewing and
   * accepted as live, so this never blocks a fresh application when their situation
   * changes — which for "no project yet" is a matter of time.
   */
  async function stopHere(reason: Disqualifier, overrides: {
    projectStatus?: ProjectStatus;
    clientOnSiteDaily?: boolean;
    willUseGroundwork?: GroundworkUse;
  } = {}) {
    if (!user || !prefill) {
      setError(t('common.somethingWrong'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const applicationId = await submitPartnerApplication(user.id, prefill, {
        languages: callLang ? [callLang] : [], diasporaHistory: history.trim(),
        hasCurrentProject: (overrides.projectStatus ?? projectStatus) != null
          && (overrides.projectStatus ?? projectStatus) !== 'none',
        whyJoin: whyJoin.trim(), differentiator: differentiator.trim(),
        regions: regions.trim(), concurrentProjects: capacity, yearsExperience: years,
        role: prefill.specialty ?? '', operatesAs, city: '',
        projectStatus: overrides.projectStatus ?? projectStatus, projectStage, projectStartWindow: startWindow,
        clientOnSiteDaily: overrides.clientOnSiteDaily ?? clientOnSiteDaily, clientOffsiteReason: offsiteReason,
        clientOffsiteReasonOther: offsiteOther.trim(),
        willUseGroundwork: overrides.willUseGroundwork ?? useGroundwork, disqualifiedReason: reason,
      });
      if (applicationId) void markPartnerDraftSubmitted(applicationId);
      clearPartnerDraftId(user.id);
      setStopped(reason);
    } catch (err) {
      setError(applicantError(err, t('partner.submitFailed'), t('partner.tradeMissing')));
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

      // The application is SENT, which is where this sequence ends. Philip was
      // explicit that it is not the booking: "sending the application and booking a
      // call are distinct steps — users could complete the application and drop off
      // beforehand", and collapsing the two would hide exactly those people.
      trackFunnel('partner_application', 'completed');

      /**
       * Open the calendar, and load what they just told us.
       *
       * Neither happened before: `openBooking` ran only in the mount effect, which
       * had already decided — before they applied — that there was no application
       * to book against. So pressing Submit filed the application and then showed a
       * screen with no calendar on it. Philip, 29 October: "the next button fails to
       * open a calendar for booking calls."
       *
       * `ready` is the same qualification rule the mount effect uses, so somebody
       * who does not qualify still sees no calendar — which is correct, and is why
       * the wording on that panel follows the frame rather than the state.
       */
      setQualified(ready);
      if (ready) void openBooking(callLang);
      void myApplicationDetail(user.id).then(setDetail).catch(() => {});

      /**
       * The applicant's copy and the team alert — the same two emails the public form
       * has always produced.
       *
       * This route sent neither. An in-app applicant heard nothing back, and nobody on
       * the team was told unless the applicant happened to ask to be spoken to in French
       * (the `needsVanessa` branch below, which is an in-app notification and not an
       * email). Since the new funnel sends everybody through this page rather than the
       * public form, that silence covered every English applicant — 46 applications
       * were sitting undecided with nothing announcing their arrival.
       *
       * Only the id is sent. The endpoint derives both recipients and both bodies from
       * the stored row, so it cannot be used to send mail to an arbitrary address.
       *
       * Fire-and-forget on purpose, exactly as the public form does it: the application
       * is already saved, and a mail failure must never read to the applicant as a
       * failed submission.
       */
      if (applicationId) {
        void fetch('/api/contractor-application-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId }),
          keepalive: true,
        }).catch(() => { /* logged server-side; the applicant is already through */ });
      }

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
      /**
       * The one error a human must never be shown raw.
       *
       * `contractor_applications_one_per_account` (100) refuses a second live
       * application. It fires when this tab's `state` is stale — another tab filed
       * one, or the first submit succeeded and its response was lost — and Philip
       * met it on a live call as the Postgres text itself:
       *   duplicate key value violates unique constraint
       *   "contractor_application_one_per_account" (23505)
       *
       * The row exists, which means the application went through. So this is not an
       * error to report: re-read the state and the page becomes their filed
       * application, which is where they were trying to get to anyway.
       */
      if (isDuplicateApplication(err)) {
        const again = await myApplicationSummary(user.id).catch(() => null);
        if (again && again.state !== 'none') {
          setState(again.state);
          setQualified(again.decisionReady);
          void myApplicationDetail(user.id).then(setDetail).catch(() => {});
          return;
        }
      }
      setError(applicantError(err, t('partner.submitFailed'), t('partner.tradeMissing')));
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

  // Already in the queue. Showing the form again would let somebody file twice and land
  // in Ruth's review list as two people.
  if (state !== 'none' && state !== 'rejected' && state !== 'disqualified') {
    return <ApplicationFiled state={state} qualified={qualified} detail={detail} booking={booking} />;
  }

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
    <form ref={formRef} onSubmit={submit} className="max-w-xl space-y-5 scroll-mt-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-brand-near-black dark:text-white">
          <ShieldCheck className="size-5" />{t('partner.applyTitle')}
        </h1>
      </div>

      {/* What they are applying FOR, before the fifteen questions (30 Oct 2026).
          Shown on the first question only: once somebody is answering, repeating the
          pitch under every question is noise. */}
      {page === 0 && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('partner.whatAPartnerGets')}
          </h2>
          <ul className="mt-1">
            {(['gets1', 'gets2', 'gets3', 'gets4'] as const).map((key, i) => (
              <li key={key}
                  className="flex gap-3 border-t border-brand-border-grey py-3 first:border-t-0 dark:border-[#2c2c2c]">
                <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-mid-grey">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-brand-near-black dark:text-white">
                    {t(`partner.${key}` as TKey)}
                  </span>
                  <span className="block text-xs text-brand-mid-grey">
                    {t(`partner.${key}Body` as TKey)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
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
        <Row label={t('partner.languages')}>
          <div className="flex gap-2">
            {LANGS.map(language => (
              <button key={language} type="button" className={chip(callLang === language)}
                onClick={() => setCallLang(language)}>
                {t(`partner.lang.${language}` as never)}
              </button>
            ))}
          </div>
        </Row>
      )}

      {page === 1 && (
        <Row label={t('partner.years')}>
          <div className="flex flex-wrap gap-2">
            {YEARS.map(value => (
              <button key={value} type="button" className={chip(years === value)}
                onClick={() => setYears(value)}>{value}</button>
            ))}
          </div>
        </Row>
      )}

      {page === 2 && (
        <Row label={t('partner.operatesAs')}>
          <div className="flex gap-2">
            {OPERATES.map(value => (
              <button key={value} type="button" className={chip(operatesAs === value)}
                onClick={() => setOperatesAs(value)}>
                {t(`partner.operates.${value}` as never)}
              </button>
            ))}
          </div>
        </Row>
      )}

      {page === 3 && (
        <Row label={t('partner.regions')}>
          <input value={regions} onChange={e => setRegions(e.target.value)} className={field}
            placeholder={t('partner.regionsPlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
        </Row>
      )}

      {page === 4 && (
        <Row label={t('partner.capacity')}>
          <div className="flex gap-2">
            {CAPACITY.map(value => (
              <button key={value} type="button" className={chip(capacity === value)}
                onClick={() => setCapacity(value)}>{value}</button>
            ))}
          </div>
        </Row>
      )}

      {page === 5 && (
        <YesNo label={t('partner.history')} value={workedDiaspora}
          onChange={value => { setWorkedDiaspora(value); if (!value) setHistory(''); }}
          chip={chip} />
      )}

      {page === 6 && (
        <Row label={t('partner.historyDescribe')} hint={t('partner.historyHint')}>
          <textarea rows={3} value={history} onChange={e => setHistory(e.target.value)} className={field} />
        </Row>
      )}

      {page === 7 && (
        <Choice label={t('partner.projectStatus')} options={PROJECT_STATUS}
          value={projectStatus} tKey="partner.projectStatusOpt" chip={chip}
          disabled={busy}
          onChange={value => {
            setProjectStatus(value as ProjectStatus);
            setProjectStage(''); setStartWindow('');
          }} />
      )}

      {page === 8 && projectStatus === 'running' && (
        <Choice label={t('partner.projectStage')} options={PROJECT_STAGES}
          value={projectStage} tKey="partner.stageOpt" chip={chip}
          onChange={setProjectStage} stacked />
      )}
      {page === 8 && projectStatus === 'starting' && (
        <Choice label={t('partner.startWindow')} options={START_WINDOWS}
          value={startWindow} tKey="partner.startOpt" chip={chip}
          onChange={setStartWindow} stacked />
      )}

      {page === 9 && (
        <YesNo label={t('partner.clientOnSite')} value={clientOnSiteDaily}
          onChange={value => {
            setClientOnSiteDaily(value);
            if (value) { setOffsiteReason(''); setOffsiteOther(''); }
          }} chip={chip} />
      )}

      {page === 10 && (
        <Choice label={t('partner.offsiteReason')} options={OFFSITE_REASONS}
          value={offsiteReason} tKey="partner.offsiteOpt" chip={chip}
          onChange={setOffsiteReason} stacked />
      )}

      {page === 11 && (
        <Row label={t('partner.offsiteReason')}>
          <input value={offsiteOther} onChange={e => setOffsiteOther(e.target.value)}
            className={field} placeholder={t('partner.offsiteOtherPlaceholder')} />
        </Row>
      )}

      {page === 12 && (
        <Choice label={t('partner.useGroundwork')} options={GROUNDWORK_USE}
          value={useGroundwork} tKey="partner.useOpt" chip={chip}
          onChange={value => setUseGroundwork(value as GroundworkUse)} stacked />
      )}

      {page === 13 && (
        <Row label={t('partner.whyJoin')}>
          <textarea rows={4} value={whyJoin} onChange={e => setWhyJoin(e.target.value)} className={field} />
        </Row>
      )}

      {page === 14 && (
        <Row label={t('partner.differentiator')}>
          <textarea rows={4} value={differentiator}
            onChange={e => setDifferentiator(e.target.value)} className={field} />
        </Row>
      )}

      {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
      {busy && (page === 7 || page === 9 || page === 12) && (
        <p role="status" className="flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" />{t('common.loading')}
        </p>
      )}

      <div className="flex items-center gap-3">
        {pageStack.length > 0 && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={goBack}
            className="text-xs font-semibold text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
            {t('common.back')}
          </button>
        )}
        {page < PAGES - 1 ? (
          <button type="button" onClick={advance} disabled={busy || !isAnswered(page)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('common.next')}
          </button>
        ) : (
          <button type="submit" disabled={busy || !complete}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
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
function Choice({ label, options, value, tKey, chip, onChange, stacked, disabled = false }: {
  label: string; options: readonly string[]; value: string | null; tKey: string;
  chip: (on: boolean) => string; onChange: (v: string) => void; stacked?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      <div className={cn('flex gap-2', stacked ? 'flex-col items-start' : 'flex-wrap')}>
        {options.map(o => (
          <button key={o} type="button" disabled={disabled}
            className={chip(value === o)} onClick={() => onChange(o)}>
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
  const optionClass = (selected: boolean) => cn(
    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
    selected
      ? 'border-brand-near-black bg-brand-near-black/5 text-brand-near-black dark:border-white dark:bg-white/10 dark:text-white'
      : 'border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-near-black/40 dark:border-[#444] dark:bg-[#1e1e1e] dark:text-brand-mid-grey dark:hover:border-white/40',
    chip(selected),
  );

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      <div className="flex flex-col gap-2">
        <label className={optionClass(value === true)}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={() => onChange(true)}
            className="h-4 w-4 accent-brand-near-black dark:accent-white"
          />
          <span>{t('common.yes')}</span>
        </label>
        <label className={optionClass(value === false)}>
          <input
            type="checkbox"
            checked={value === false}
            onChange={() => onChange(false)}
            className="h-4 w-4 accent-brand-near-black dark:accent-white"
          />
          <span>{t('common.no')}</span>
        </label>
      </div>
    </div>
  );
}

/**
 * Where this application stands, as five steps.
 *
 * Every step's state is read from what the database actually says. In particular
 * **"call booked" is never claimed**: Groundwork can see that somebody was sent to a
 * calendar, not that they chose a slot — so the step is "book your call", and it
 * stays current until the application is accepted. Counting a booking we cannot
 * observe would put a number in the funnel that nothing backs up.
 */
function FunnelTrack({ state, qualified, hasBooking, detail }: {
  state: ApplicationState; qualified: boolean; hasBooking: boolean;
  detail?: PartnerApplicationDetail | null;
}) {
  const t = useT();

  // One derivation, shared with the dashboard card (partner-track.ts). These two used
  // to decide the steps separately and could disagree about the same application:
  // the card read the status alone, so "Qualified" lit up when staff moved the row to
  // `reviewing` rather than when the applicant actually qualified.
  //
  // `hasBooking` is no longer part of the rule. Whether a calendar happens to be
  // rendered right now is a property of this page, not of the application; the
  // tracked fact is `booking_shown_at`.
  void hasBooking;
  const steps = partnerTrack({
    state,
    decisionReady:  qualified,
    appliedAt:      detail?.appliedAt ?? null,
    bookingShownAt: detail?.bookingShownAt ?? null,
  }).map(step => ({
    key: `partner.track.${step.key}` as TKey,
    at: step.at,
    on: step.on ? formatDate(step.on) : null,
  }));

  return (
    <ol className="mt-4 flex min-w-0">
      {steps.map((step, i) => (
        <li key={step.key} className="relative min-w-0 flex-1 text-center"
            aria-current={step.at === 'now' ? 'step' : undefined}>
          {i > 0 && (
            <span aria-hidden className={cn('absolute -left-1/2 top-[9px] h-0.5 w-full',
              step.at === 'todo' ? 'bg-brand-border-grey dark:bg-[#2c2c2c]' : 'bg-state-complete')} />
          )}
          <span className={cn(
            'relative z-[1] mx-auto flex size-5 items-center justify-center rounded-full border-2 font-mono text-[10px] font-semibold',
            step.at === 'done' && 'border-state-complete bg-state-complete text-white',
            step.at === 'now'  && 'border-state-complete bg-white text-state-complete ring-[3px] ring-state-complete/15 dark:bg-[#1e1e1e]',
            step.at === 'todo' && 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
          )}>
            {step.at === 'done' ? <Check className="size-2.5 stroke-[3]" aria-hidden /> : i + 1}
          </span>
          <span className={cn('mt-1.5 block break-words px-px text-[10px] leading-tight',
            step.at === 'now'
              ? 'font-semibold text-brand-near-black dark:text-white'
              : 'text-brand-mid-grey')}>
            {t(step.key)}
          </span>
          {/* A step with no date we own prints an em dash, not a guess. */}
          <span className="mt-0.5 block break-words px-px text-[10px] text-brand-mid-grey">
            {step.on ?? '—'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The application, once it is filed.
 *
 * Philip's layout, 30 October: the funnel track with the date each step happened,
 * then exactly what they told us, then what a partner gets — and the call on the
 * right. No "change my answers": once they have answered, they have answered, and
 * an edit after filing would put the applicant and Ruth's review list out of step.
 *
 * Every line is read from their own row. A field the row does not carry is left out
 * rather than guessed at, which is why the list is built and then filtered.
 */
function ApplicationFiled({ state, qualified, detail, booking }: {
  state: ApplicationState;
  qualified: boolean;
  detail: PartnerApplicationDetail | null;
  booking: string | null | 'unset';
}) {
  const t = useT();
  const accepted = state === 'accepted';
  const hasCalendar = booking !== 'unset' && booking !== null;

  /**
   * Where this application actually stands, in one line.
   *
   * It used to read "we have your application" whatever had happened since,
   * which is why Favour asked for the call trail to "accurately display the
   * booking status". It now follows the same facts the track below it does —
   * and still never claims a call is BOOKED, because the slot lives in the
   * team's calendar and not here (migration 136).
   */
  const trailStatus: TKey =
    accepted                      ? 'partner.statusAcceptedTitle'
    : !qualified                  ? 'partner.trailReviewing'
    : detail?.bookingShownAt      ? 'partner.trailChooseTime'
    : hasCalendar                 ? 'partner.trailBookNow'
    :                               'partner.statusPendingTitle';

  const told: { q: string; a: string }[] = [
    { q: t('partner.projectStatus'),
      a: detail?.projectStatus ? t(`partner.projectStatusOpt.${detail.projectStatus}` as TKey) : '' },
    { q: t('partner.projectStage'),
      a: detail?.projectStage ? t(`partner.stageOpt.${detail.projectStage}` as TKey) : '' },
    { q: t('partner.startWindow'),
      a: detail?.projectStartWindow ? t(`partner.startOpt.${detail.projectStartWindow}` as TKey) : '' },
    { q: t('partner.clientOnSite'),
      a: detail?.clientOnSiteDaily === null || detail?.clientOnSiteDaily === undefined ? ''
         : detail.clientOnSiteDaily ? t('common.yes')
         : detail.clientOffsiteReason === 'other' && detail.clientOffsiteReasonOther
           ? `${t('common.no')} — ${detail.clientOffsiteReasonOther}`
           : detail.clientOffsiteReason
             ? `${t('common.no')} — ${t(`partner.offsiteOpt.${detail.clientOffsiteReason}` as TKey)}`
             : t('common.no') },
    { q: t('partner.useGroundwork'),
      a: detail?.willUseGroundwork ? t(`partner.useOpt.${detail.willUseGroundwork}` as TKey) : '' },
    { q: t('partner.years'),    a: detail?.yearsExperience ?? '' },
    { q: t('partner.operatesAs'),
      a: detail?.operatesAs ? t(`partner.operates.${detail.operatesAs}` as TKey) : '' },
    { q: t('partner.regions'),  a: detail?.regions ?? '' },
    { q: t('partner.capacity'), a: detail?.concurrentProjects ?? '' },
  ].filter(row => row.a !== '');

  return (
    <div className="grid max-w-5xl items-start gap-5 lg:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-bold tracking-tight text-brand-near-black dark:text-white">
              {t('partner.yourApplication')}
            </h1>
            <span className={cn('flex items-center gap-1.5 text-xs font-semibold',
              accepted ? 'text-state-complete' : 'text-state-held')}>
              <span aria-hidden className={cn('size-1.5 rounded-full',
                accepted ? 'bg-state-complete' : 'bg-state-held')} />
              {t(trailStatus)}
            </span>
          </div>
          <p className="mt-1 text-xs text-brand-mid-grey">{t('partner.oneConversation')}</p>
          <FunnelTrack state={state} qualified={qualified} detail={detail}
                       hasBooking={booking !== 'unset' && booking !== null} />
        </section>

        {told.length > 0 && (
          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('partner.whatYouToldUs')}
            </h2>
            <dl className="mt-1">
              {told.map(row => (
                <div key={row.q}
                     className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-t border-brand-border-grey py-2.5 first:border-t-0 dark:border-[#2c2c2c]">
                  <dt className="min-w-0 text-xs text-brand-mid-grey">{row.q}</dt>
                  <dd className="text-right text-xs font-semibold text-brand-near-black dark:text-white">{row.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('partner.whatAPartnerGets')}
          </h2>
          <ul className="mt-1">
            {(['gets1', 'gets2', 'gets3', 'gets4'] as const).map((key, i) => (
              <li key={key}
                  className="flex gap-3 border-t border-brand-border-grey py-3 first:border-t-0 dark:border-[#2c2c2c]">
                <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-mid-grey">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-brand-near-black dark:text-white">
                    {t(`partner.${key}` as TKey)}
                  </span>
                  <span className="block text-xs text-brand-mid-grey">
                    {t(`partner.${key}Body` as TKey)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('partner.yourCall')}
          </h2>

          {/* "Booking opened {date}" was here. Removed 30 Oct 2026 — it reported our
              own tracking back to the applicant, who did not ask when we showed them
              a calendar. */}

          {/* Only the NO-calendar case says anything now. When the calendar is on
              screen it speaks for itself, and explaining that the appointment lives
              in Google rather than here is our plumbing, not their business.

              The rule partner-status-copy.test.ts was written to hold still stands,
              and in a stronger form: the wording follows the FRAME, never the stored
              `booking_shown_at`. "Pick a slot below" on a page with no calendar under
              it is the defect it exists to prevent, and there is now no line at all
              that can point at a calendar that is not there. */}
          {!booking && (
            <p className="mt-1 text-xs text-brand-mid-grey">{t('partner.statusPendingBody')}</p>
          )}

          {booking !== 'unset' && (booking ? (
            <iframe
              src={booking} title={t('partner.bookTitle')}
              className="mt-3 h-[560px] w-full rounded-xl border border-brand-border-grey dark:border-[#2c2c2c]"
            />
          ) : (
            // No schedule configured. Said plainly — an empty frame reads as broken.
            <p className="mt-3 rounded-xl border border-brand-border-grey p-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c]">
              {t('partner.bookUnavailable')}
            </p>
          ))}
        </section>

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('partner.whoYouWillSpeakTo')}
          </h2>
          <Speaker initials="PH" name="Philip" role={t('partner.partnerTeam')} />
          {/* A co-host sits on the SCHEDULE, not the booking — see partner-booking.ts.
              She is on the French call, so she is named only on the French one. */}
          {detail && needsVanessa(detail.language) && (
            <Speaker initials="VG" name="Vanessa G." role={t('partner.partnerTeam')} />
          )}
          {/* "The call is held in French, and Vanessa joins it" was here. Removed
              30 Oct 2026 at Favour's request. The names above already say who will be
              on the call; the sentence only explained why, which is ours to know. */}
        </section>

        <Link to="/work" className="text-xs underline underline-offset-2 text-brand-mid-grey">
          {t('contractor.nav.dashboard')}
        </Link>
      </div>
    </div>
  );
}

function Speaker({ initials, name, role }: { initials: string; name: string; role: string }) {
  return (
    <div className="mt-2 flex items-center gap-2.5 border-t border-brand-border-grey pt-2.5 first:border-t-0 dark:border-[#2c2c2c]">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-border-grey text-[10px] font-bold text-brand-mid-grey dark:border-[#2c2c2c]">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-brand-near-black dark:text-white">{name}</span>
        <span className="block text-[11px] text-brand-mid-grey">{role}</span>
      </span>
    </div>
  );
}
