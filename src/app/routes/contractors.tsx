import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Phone,
  Mail,
  MessageCircle,
  CheckCircle2,
  Lock,
  ChevronRight,
  X,
  Search,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import BackToTop from '@/components/ui/BackToTop';
import { useT, type TKey } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';
import { CONTRACTORS_LOCKED_FOR_DEMO } from '@/lib/demo-gate';

// ── Types ─────────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'enterprise';

interface Contractor {
  id: string;
  name: string;
  trade: string;
  location: string;
  rating: number;
  review_count: number;
  verified: boolean;
  years_exp: number;
  completed_projects: number;
  specialties: string[];
  bio: string | null;
  phone: string | null;
  email: string | null;
  avatar_initials: string;
}

// ── Filter categories ──────────────────────────────────────

// Mirrors the taxonomy the contractor application already collects
// (`contractorApply.role.*`), so someone who applies as a plumber is findable as
// one. Philip named plumbers, lawyers and land experts specifically; the trades are
// grouped under one chip rather than five, because a client hiring a mason is
// usually hiring through a contractor and does not want six near-empty categories.
type FilterKey =
  | 'All' | 'Contractor' | 'Engineer' | 'Architect'
  | 'Surveyor' | 'Lawyer' | 'Plumber' | 'Electrician' | 'Trades';

const FILTERS: FilterKey[] = [
  'All', 'Contractor', 'Engineer', 'Architect',
  'Surveyor', 'Lawyer', 'Plumber', 'Electrician', 'Trades',
];

const FILTER_LABEL: Record<FilterKey, TKey> = {
  'All':         'contractors.filters.all',
  'Contractor':  'contractors.filters.contractor',
  'Engineer':    'contractors.filters.engineer',
  'Architect':   'contractors.filters.architect',
  'Surveyor':    'contractors.filters.surveyor',
  'Lawyer':      'contractors.filters.lawyer',
  'Plumber':     'contractors.filters.plumber',
  'Electrician': 'contractors.filters.electrician',
  'Trades':      'contractors.filters.trades',
};

/**
 * Keywords matched against the free-text `trade` column, lower-cased.
 *
 * Keyword matching rather than an enum because `trade` is free text written by
 * whoever onboarded the contractor — "Structural Engineer", "Civil Engineer" and
 * "Engineer" must all land under Engineer.
 */
const FILTER_KEYWORDS: Record<Exclude<FilterKey, 'All'>, string[]> = {
  Contractor:  ['general contractor', 'contractor', 'builder'],
  Engineer:    ['engineer'],
  Architect:   ['architect', 'designer'],
  Surveyor:    ['surveyor', 'land expert'],
  Lawyer:      ['lawyer', 'notary', 'legal'],
  Plumber:     ['plumb'],
  Electrician: ['electric'],
  Trades:      ['mason', 'carpenter', 'roofing', 'interior', 'finishing', 'tiler', 'welder', 'painter'],
};

/**
 * Free-text match over the fields a person would actually type: who they are, what
 * they do, where they are, and what they specialise in. Accents are stripped so
 * "Yaounde" finds "Yaoundé" — most people will not reach for the diacritic.
 */
const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function matchesQuery(c: Contractor, q: string): boolean {
  if (!q.trim()) return true;
  const hay = norm([c.name, c.trade, c.location, ...c.specialties].join(' '));
  return norm(q).trim().split(/\s+/).every(term => hay.includes(term));
}

function matchesFilter(contractor: Contractor, filter: FilterKey): boolean {
  if (filter === 'All') return true;
  const trade = contractor.trade.toLowerCase();
  // "General Contractor" contains "contractor", so the Contractor chip would also
  // swallow every specialist whose title ends in it — check the narrower chips first.
  if (filter !== 'Contractor') {
    return FILTER_KEYWORDS[filter].some(k => trade.includes(k));
  }
  const claimedElsewhere = (Object.keys(FILTER_KEYWORDS) as Exclude<FilterKey, 'All'>[])
    .filter(k => k !== 'Contractor')
    .some(k => FILTER_KEYWORDS[k].some(w => trade.includes(w)));
  return !claimedElsewhere && FILTER_KEYWORDS.Contractor.some(k => trade.includes(k));
}

// ── Sub-components ─────────────────────────────────────────

function ScoreBadge({ rating, reviews }: { rating: number; reviews: number }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-brand-mid-grey">
      <span className="inline-flex items-baseline gap-0.5 rounded-md bg-brand-off-white px-1.5 py-0.5">
        <span className="font-bold tabular-nums text-brand-near-black">{rating.toFixed(1)}</span>
        <span className="text-[9px] text-brand-mid-grey">/5</span>
      </span>
      <span>{t('contractors.scoreFrom', { count: reviews })}</span>
    </span>
  );
}

function SpecialtyPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-pale px-2.5 py-0.5 text-[10px] font-medium text-brand-mid-grey tracking-wide uppercase border border-brand-border-grey">
      {label}
    </span>
  );
}

function ContactSection({ contractor, plan }: { contractor: Contractor; plan: Plan }) {
  const t = useT();
  const isUnlocked = plan === 'pro' || plan === 'enterprise';

  if (isUnlocked && contractor.phone) {
    return (
      <div className="flex flex-wrap gap-2 pt-3 border-t border-brand-border-grey mt-3">
        <a
          href={`tel:${contractor.phone}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <Phone className="size-3 shrink-0" />
          {contractor.phone}
        </a>
        {contractor.email && (
          <a
            href={`mailto:${contractor.email}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
          >
            <Mail className="size-3 shrink-0" />
            {contractor.email}
          </a>
        )}
        {contractor.phone && (
          <a
            href={`https://wa.me/${contractor.phone.replace(/\s+/g, '').replace('+', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
          >
            <MessageCircle className="size-3 shrink-0" />
            {t('contractors.whatsapp')}
          </a>
        )}
      </div>
    );
  }

  // Starter — blurred contact with upgrade prompt
  return (
    <div className="relative pt-3 border-t border-brand-border-grey mt-3">
      <div className="blur-sm select-none pointer-events-none flex flex-wrap gap-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black">
          <Phone className="size-3 shrink-0" />
          +234 8XX XXX XXXX
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black">
          <Mail className="size-3 shrink-0" />
          hidden@example.com
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-start pl-0.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
          <Lock className="size-3 shrink-0" />
          {t('contractors.unlockWithPro')}
        </span>
      </div>
    </div>
  );
}

// ── Contractor profile (Design B + elements from A) ────────
//
// Design B's centred dark hero, opened from a directory card rather than living at
// its own route: the directory is where the decision gets made, and sending someone
// to a separate page to read a bio loses their place in the list they were scanning.
//
// From Design A, per the 3 Aug decision: the gated contact block, the upgrade path,
// and an explicit "Specialties" heading — B showed bare chips with nothing saying
// what they were.

function ContractorProfileModal({
  contractor, plan, onRequestQuote, onClose,
}: {
  contractor: Contractor;
  plan: Plan;
  onRequestQuote: (c: Contractor) => void;
  onClose: () => void;
}) {
  const tradeLabel = useDomainLabels().trade;
  const t = useT();
  const initials = contractor.avatar_initials
    || contractor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={contractor.name}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={e => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
      >
        {/* Dark centred hero */}
        <div className="relative rounded-t-2xl bg-brand-near-black px-6 pb-6 pt-7 text-center text-white">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>

          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-white/10 text-lg font-bold">
            {initials}
          </div>
          <h2 className="text-lg font-extrabold leading-snug">{contractor.name}</h2>

          {contractor.verified && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold">
              <CheckCircle2 className="size-3" />
              {t('contractors.verifiedProfessional')}
            </span>
          )}

          <p className="mt-2 text-xs text-white/45">
            {[tradeLabel(contractor.trade), contractor.location].filter(Boolean).join(' · ')}
          </p>

          {/* Score, not stars — see ScoreBadge. */}
          <div className="mt-4 flex items-center justify-center gap-6 text-[11px] text-white/55">
            {contractor.review_count > 0 && (
              <span className="flex flex-col">
                <span className="text-sm font-bold tabular-nums text-white">{contractor.rating.toFixed(1)}<span className="text-[9px] text-white/40">/5</span></span>
                {t('contractors.statScore')}
              </span>
            )}
            <span className="flex flex-col">
              <span className="text-sm font-bold tabular-nums text-white">{contractor.years_exp}</span>
              {t('contractors.statYears')}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-bold tabular-nums text-white">{contractor.completed_projects}</span>
              {t('contractors.statProjects')}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          {contractor.bio && (
            <p className="text-xs leading-relaxed text-brand-near-black dark:text-white">{contractor.bio}</p>
          )}

          {contractor.specialties.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-brand-mid-grey">
                {t('contractors.specialtiesLabel')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {contractor.specialties.map(sp => <SpecialtyPill key={sp} label={sp} />)}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand-mid-grey">
              {t('contractors.contactLabel')}
            </p>
            <ContactSection contractor={contractor} plan={plan} />
          </div>

          <button
            type="button"
            onClick={() => { onRequestQuote(contractor); onClose(); }}
            className="w-full rounded-xl bg-brand-near-black py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t('contractors.requestIntroduction')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ContractorCard({
  contractor,
  plan,
  onRequestQuote,
  onViewProfile,
}: {
  contractor: Contractor;
  plan: Plan;
  onRequestQuote: (c: Contractor) => void;
  onViewProfile: (c: Contractor) => void;
}) {
  const tradeLabel = useDomainLabels().trade;
  const t = useT();
  const isUnlocked = plan === 'pro' || plan === 'enterprise';

  return (
    <div className="group flex flex-col rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200">

      {/* Header: avatar + verified */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-white text-sm font-bold tracking-wide select-none">
            {contractor.avatar_initials || contractor.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-brand-near-black text-base leading-snug truncate">
              {contractor.name}
            </p>
            <p className="text-sm text-brand-mid-grey truncate">{tradeLabel(contractor.trade)}</p>
          </div>
        </div>

        {contractor.verified && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-off-white border border-state-complete/30 px-2 py-0.5 text-[10px] font-semibold text-state-complete">
            <CheckCircle2 className="size-3" />
            {t('contractors.verified')}
          </span>
        )}
      </div>

      {/* Location + rating */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="inline-flex items-center gap-1 text-xs text-brand-mid-grey">
          <MapPin className="size-3 shrink-0" />
          {contractor.location}
        </span>
        {contractor.review_count > 0 && (
          <ScoreBadge rating={contractor.rating} reviews={contractor.review_count} />
        )}
      </div>

      {/* Bio */}
      {contractor.bio && (
        <p className="text-xs text-brand-mid-grey leading-relaxed line-clamp-2 mb-3">
          {contractor.bio}
        </p>
      )}

      {/* Stats row */}
      <div className="flex gap-4 mb-3">
        <div>
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">{t('contractors.experience')}</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{contractor.years_exp} yrs</p>
        </div>
        <div>
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">{t('contractors.projects')}</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{contractor.completed_projects}</p>
        </div>
      </div>

      {/* Specialties */}
      {contractor.specialties.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-auto">
          {contractor.specialties.map((s) => (
            <SpecialtyPill key={s} label={s} />
          ))}
        </div>
      )}

      {/* Contact section (tier-gated) */}
      <ContactSection contractor={contractor} plan={plan} />

      {/* Opens the full profile. Available on every plan — the gating is on the
          contact details inside it, not on reading who someone is. */}
      <button
        type="button"
        onClick={() => onViewProfile(contractor)}
        className="mt-3 w-full rounded-xl border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-near-black hover:bg-brand-off-white"
      >
        {t('contractors.viewProfile')}
      </button>

      {/* Request Quote CTA */}
      <div className="mt-2">
        {isUnlocked ? (
          <button
            type="button"
            onClick={() => onRequestQuote(contractor)}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-brand-near-black text-white text-xs font-semibold py-2.5 hover:bg-black transition-colors group/btn"
          >
            {t('contractors.requestQuote')}
            <ChevronRight className="size-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        ) : (
          <button
            type="button"
            disabled
            title={t('contractors.upgradeNotice')}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey text-xs font-medium text-brand-mid-grey py-2.5 cursor-not-allowed opacity-60"
          >
            <Lock className="size-3" />
            {t('contractors.upgradeToContact')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Quote Request Dialog ───────────────────────────────────

function QuoteRequestDialog({
  contractor,
  onClose,
}: {
  contractor: Contractor;
  onClose: () => void;
}) {
  const tradeLabel = useDomainLabels().trade;
  const t = useT();
  const [submitted, setSubmitted] = useState(false);

  const inputCls =
    'w-full rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] px-3 py-2.5 text-sm text-brand-near-black dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white';
  const labelCls = 'block text-xs font-medium text-brand-mid-grey mb-1';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1e1e1e] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-brand-border-grey dark:border-[#2c2c2c]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-white text-sm font-bold tracking-wide select-none">
              {contractor.avatar_initials ||
                contractor.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-brand-near-black dark:text-white text-sm leading-snug truncate">
                {contractor.name}
              </p>
              <p className="text-xs text-brand-mid-grey truncate">{tradeLabel(contractor.trade)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center size-8 rounded-full text-brand-mid-grey hover:bg-brand-pale dark:hover:bg-[#282828] hover:text-brand-near-black dark:hover:text-white transition-colors"
            aria-label={t('contractors.inquiry.closeDialog')}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {submitted ? (
            /* Success state */
            <div className="flex flex-col items-center text-center py-6 gap-4">
              <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white border border-state-complete/30">
                <CheckCircle2 className="size-7 text-state-complete" />
              </div>
              <div>
                <p className="font-bold text-brand-near-black dark:text-white text-base">
                  {t('contractors.inquiry.sent')}
                </p>
                <p className="mt-1 text-sm text-brand-mid-grey max-w-xs">
                  Your inquiry has been sent.{' '}
                  <span className="text-brand-near-black dark:text-white font-medium">
                    {contractor.name}
                  </span>{' '}
                  will contact you within 48 hours.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-2.5 hover:bg-black transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            /* Form */
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <label className={labelCls} htmlFor="qr-name">
                  {t('contractors.inquiry.yourName')}
                </label>
                <input
                  id="qr-name"
                  type="text"
                  required
                  placeholder={t('fields.namePlaceholder')}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-location">
                  {t('contractors.inquiry.location')}
                </label>
                <input
                  id="qr-location"
                  type="text"
                  required
                  placeholder={t('fields.cityPlaceholder')}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-build-type">
                  {t('contractors.inquiry.buildType')}
                </label>
                <select id="qr-build-type" required className={inputCls}>
                  <option value="">{t('contractors.inquiry.selectBuildType')}</option>
                  <option value="residential">{t('contractors.inquiry.residential')}</option>
                  <option value="commercial">{t('contractors.inquiry.commercial')}</option>
                  <option value="industrial">{t('contractors.inquiry.industrial')}</option>
                  <option value="mixed-use">{t('contractors.inquiry.mixedUse')}</option>
                </select>
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-message">
                  {t('contractors.inquiry.message')}
                </label>
                <textarea
                  id="qr-message"
                  rows={3}
                  required
                  placeholder={t('contractors.inquiry.messageHint')}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-contact-pref">
                  {t('contractors.inquiry.preferredContact')}
                </label>
                <select id="qr-contact-pref" required className={inputCls}>
                  <option value="whatsapp">{t('contractors.whatsapp')}</option>
                  <option value="email">{t('contractors.inquiry.email')}</option>
                  <option value="phone">{t('contractors.inquiry.phoneCall')}</option>
                </select>
              </div>

              <p className="text-[11px] text-brand-mid-grey leading-relaxed">
                Your contact details from your Groundwork profile will be shared with this
                professional.
              </p>

              <button
                type="submit"
                className="w-full flex items-center justify-center rounded-xl bg-brand-near-black text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors"
              >
                {t('contractors.inquiry.send')}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-brand-border-grey bg-white p-5 gap-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-full bg-brand-light-grey shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-4 w-32 rounded bg-brand-light-grey" />
          <div className="h-3 w-24 rounded bg-brand-light-grey" />
        </div>
      </div>
      <div className="h-3 w-40 rounded bg-brand-light-grey" />
      <div className="h-3 w-full rounded bg-brand-light-grey" />
      <div className="h-3 w-3/4 rounded bg-brand-light-grey" />
      <div className="h-8 w-full rounded-xl bg-brand-light-grey mt-2" />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

export default function ContractorsPage() {
  const t = useT();
  const { user } = useAuth();

  // Derive plan from onboarding-saved user metadata
  const rawTier = user?.user_metadata?.tier ?? 'starter';
  const plan: Plan = (['starter', 'pro', 'enterprise'] as Plan[]).includes(rawTier as Plan)
    ? (rawTier as Plan)
    : 'starter';

  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All');
  const [query, setQuery] = useState('');
  const [quoteTarget, setQuoteTarget] = useState<Contractor | null>(null);
  const [profileTarget, setProfileTarget] = useState<Contractor | null>(null);

  useEffect(() => {
    // TEMPORARY (demo gate): skip the fetch entirely, so no contractor name is
    // downloaded. Hiding them in the render would still leave them in the network tab.
    if (CONTRACTORS_LOCKED_FOR_DEMO) { setFetchState('ready'); return; }
    supabase
      .from('contractors')
      .select('*')
      .eq('active', true)
      .order('verified', { ascending: false })
      .order('rating', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setFetchState('error');
        } else {
          setContractors((data ?? []) as Contractor[]);
          setFetchState('ready');
        }
      });
  }, []);

  const visible = contractors.filter(c => matchesFilter(c, activeFilter) && matchesQuery(c, query));

  // TEMPORARY (demo gate) — see lib/demo-gate.ts.
  if (CONTRACTORS_LOCKED_FOR_DEMO) return <ContractorsLocked />;

  return (
    <div className="bg-brand-off-white min-h-full">
      <AnimatePresence>
        {quoteTarget && (
          <QuoteRequestDialog
            contractor={quoteTarget}
            onClose={() => setQuoteTarget(null)}
          />
        )}
        {profileTarget && (
          <ContractorProfileModal
            contractor={profileTarget}
            plan={plan}
            onRequestQuote={(c) => setQuoteTarget(c)}
            onClose={() => setProfileTarget(null)}
          />
        )}
      </AnimatePresence>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-6"
        >
          <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
            {t('contractors.title')}
          </h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            {t('contractors.subtitle')}
          </p>
        </motion.div>

        {/* Search — required by the 3 Aug decision; Design A had chips only. */}
        {fetchState === 'ready' && contractors.length > 0 && (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('contractors.searchPlaceholder')}
              aria-label={t('contractors.searchPlaceholder')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2.5 pl-9 pr-3 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
            />
          </div>
        )}

        {/* Filter bar */}
        {fetchState === 'ready' && contractors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="flex flex-wrap gap-2 mb-7"
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeFilter === f
                    ? 'bg-brand-near-black text-white'
                    : 'bg-brand-off-white border border-brand-border-grey text-brand-mid-grey hover:border-brand-near-black hover:text-brand-near-black'
                }`}
              >
                {t(FILTER_LABEL[f])}
              </button>
            ))}
          </motion.div>
        )}

        {/* Loading */}
        {fetchState === 'loading' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <CardSkeleton key={i} />)}
          </div>
        )}

        {/* Error */}
        {fetchState === 'error' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm font-medium text-brand-near-black">{t('contractors.loadFailed')}</p>
            <p className="text-xs text-brand-mid-grey mt-1">{t('contractors.refreshRetry')}</p>
          </div>
        )}

        {/* Empty — no contractors onboarded yet */}
        {fetchState === 'ready' && contractors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full border-2 border-dashed border-brand-border-grey">
              <CheckCircle2 className="size-6 text-brand-mid-grey" />
            </div>
            <p className="text-sm font-semibold text-brand-near-black">{t('contractors.emptyTitle')}</p>
            <p className="text-xs text-brand-mid-grey mt-1 max-w-xs">
              The Jalla team is vetting professionals. Check back soon, or{' '}
              <Link to="/contractor-apply" className="underline underline-offset-2 hover:text-brand-near-black transition-colors">
                apply to join
              </Link>.
            </p>
          </div>
        )}

        {/* Grid */}
        {fetchState === 'ready' && contractors.length > 0 && (
          <AnimatePresence mode="popLayout">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visible.map((contractor, i) => (
                <motion.div
                  key={contractor.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.28, delay: i * 0.04 }}
                >
                  <ContractorCard
                    contractor={contractor}
                    plan={plan}
                    onRequestQuote={(c) => setQuoteTarget(c)}
                    onViewProfile={(c) => setProfileTarget(c)}
                  />
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}

        {/* Filtered empty */}
        {fetchState === 'ready' && contractors.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-brand-near-black">{t('contractors.emptyCategory')}</p>
            <p className="text-xs text-brand-mid-grey mt-1">{t('contractors.tryFilter')}</p>
          </div>
        )}

        {/* Footer note */}
        {fetchState === 'ready' && contractors.length > 0 && (
          <p className="mt-10 text-center text-xs text-brand-mid-grey">
            {t('contractors.screenedNote')}{' '}
            <Link
              to="/contractor-apply"
              className="underline underline-offset-4 hover:text-brand-near-black transition-colors"
            >
              {t('contractors.applyToJoin')}
            </Link>
          </p>
        )}
      </div>

      <BackToTop />
    </div>
  );
}

// ── TEMPORARY: demo gate prompt ────────────────────────────
//
// Delete this component together with lib/demo-gate.ts. It deliberately borrows the
// page's own surface and the Lock affordance already used by the plan gate above, so
// it reads as the same product rather than a placeholder bolted on.

function ContractorsLocked() {
  const t = useT();
  return (
    <div className="bg-brand-off-white min-h-full dark:bg-transparent">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          role="dialog"
          aria-modal="false"
          className="w-full max-w-md rounded-2xl border border-brand-border-grey bg-white p-8 text-center shadow-[0_8px_40px_rgba(0,0,0,0.10)] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
        >
          <span className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black">
            <Lock className="size-5" />
          </span>
          <h1 className="text-lg font-bold text-brand-near-black dark:text-white">
            {t('contractors.lockedTitle')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-brand-mid-grey">
            {t('contractors.lockedBody')}
          </p>
          <Link
            to="/upgrade"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-near-black px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-brand-near-black dark:hover:bg-brand-off-white"
          >
            {t('contractors.lockedCta')}
            <ChevronRight className="size-4" />
          </Link>
          <Link
            to="/dashboard"
            className="mt-3 inline-block text-xs font-medium text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black dark:hover:text-white"
          >
            {t('contractors.lockedBack')}
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
