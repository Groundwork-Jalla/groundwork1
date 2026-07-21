import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Star,
  Phone,
  Mail,
  MessageCircle,
  CheckCircle2,
  Lock,
  ChevronRight,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import BackToTop from '@/components/ui/BackToTop';

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

type FilterKey = 'All' | 'General Contractor' | 'Engineer' | 'Surveyor' | 'Designer';

const FILTERS: FilterKey[] = ['All', 'General Contractor', 'Engineer', 'Surveyor', 'Designer'];

function matchesFilter(contractor: Contractor, filter: FilterKey): boolean {
  if (filter === 'All') return true;
  if (filter === 'General Contractor') return contractor.trade === 'General Contractor';
  if (filter === 'Engineer') return contractor.trade.includes('Engineer');
  if (filter === 'Surveyor') return contractor.trade.includes('Surveyor');
  if (filter === 'Designer') return contractor.trade.includes('Designer');
  return false;
}

// ── Sub-components ─────────────────────────────────────────

function StarRating({ rating, reviews }: { rating: number; reviews: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-brand-mid-grey">
      <Star className="size-3 fill-brand-near-black text-brand-near-black" />
      <span className="font-medium text-brand-near-black tabular-nums">{rating.toFixed(1)}</span>
      <span>({reviews} reviews)</span>
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
            WhatsApp
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
          Unlock with Pro
        </span>
      </div>
    </div>
  );
}

function ContractorCard({
  contractor,
  plan,
  onRequestQuote,
}: {
  contractor: Contractor;
  plan: Plan;
  onRequestQuote: (c: Contractor) => void;
}) {
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
            <p className="text-sm text-brand-mid-grey truncate">{contractor.trade}</p>
          </div>
        </div>

        {contractor.verified && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[10px] font-semibold text-green-700">
            <CheckCircle2 className="size-3" />
            Verified
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
          <StarRating rating={contractor.rating} reviews={contractor.review_count} />
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
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">Experience</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{contractor.years_exp} yrs</p>
        </div>
        <div>
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">Projects</p>
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

      {/* Request Quote CTA */}
      <div className="mt-3">
        {isUnlocked ? (
          <button
            type="button"
            onClick={() => onRequestQuote(contractor)}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-brand-near-black text-white text-xs font-semibold py-2.5 hover:bg-black transition-colors group/btn"
          >
            Request Quote
            <ChevronRight className="size-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="Upgrade to Pro to contact this professional"
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey text-xs font-medium text-brand-mid-grey py-2.5 cursor-not-allowed opacity-60"
          >
            <Lock className="size-3" />
            Upgrade to contact
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
              <p className="text-xs text-brand-mid-grey truncate">{contractor.trade}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center size-8 rounded-full text-brand-mid-grey hover:bg-brand-pale dark:hover:bg-[#282828] hover:text-brand-near-black dark:hover:text-white transition-colors"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {submitted ? (
            /* Success state */
            <div className="flex flex-col items-center text-center py-6 gap-4">
              <div className="flex size-14 items-center justify-center rounded-full bg-green-50 border border-green-200">
                <CheckCircle2 className="size-7 text-green-600" />
              </div>
              <div>
                <p className="font-bold text-brand-near-black dark:text-white text-base">
                  Inquiry sent!
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
                Close
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
                  Your name
                </label>
                <input
                  id="qr-name"
                  type="text"
                  required
                  placeholder="e.g. David Okafor"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-location">
                  Project location
                </label>
                <input
                  id="qr-location"
                  type="text"
                  required
                  placeholder="e.g. Douala, Cameroon"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-build-type">
                  Build type
                </label>
                <select id="qr-build-type" required className={inputCls}>
                  <option value="">Select a build type</option>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="industrial">Industrial</option>
                  <option value="mixed-use">Mixed Use</option>
                </select>
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-message">
                  Message
                </label>
                <textarea
                  id="qr-message"
                  rows={3}
                  required
                  placeholder="Describe your project — size, timeline, and any specific requirements"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="qr-contact-pref">
                  Preferred contact
                </label>
                <select id="qr-contact-pref" required className={inputCls}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone call</option>
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
                Send Inquiry
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
  const { user } = useAuth();

  // Derive plan from onboarding-saved user metadata
  const rawTier = user?.user_metadata?.tier ?? 'starter';
  const plan: Plan = (['starter', 'pro', 'enterprise'] as Plan[]).includes(rawTier as Plan)
    ? (rawTier as Plan)
    : 'starter';

  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All');
  const [quoteTarget, setQuoteTarget] = useState<Contractor | null>(null);

  useEffect(() => {
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

  const visible = contractors.filter((c) => matchesFilter(c, activeFilter));

  return (
    <div className="bg-brand-off-white min-h-full">
      <AnimatePresence>
        {quoteTarget && (
          <QuoteRequestDialog
            contractor={quoteTarget}
            onClose={() => setQuoteTarget(null)}
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
            Contractor Directory
          </h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            Verified professionals for your build
          </p>
        </motion.div>

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
                {f}
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
            <p className="text-sm font-medium text-brand-near-black">Could not load contractors.</p>
            <p className="text-xs text-brand-mid-grey mt-1">Please refresh and try again.</p>
          </div>
        )}

        {/* Empty — no contractors onboarded yet */}
        {fetchState === 'ready' && contractors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full border-2 border-dashed border-brand-border-grey">
              <CheckCircle2 className="size-6 text-brand-mid-grey" />
            </div>
            <p className="text-sm font-semibold text-brand-near-black">No contractors listed yet</p>
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
                  />
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}

        {/* Filtered empty */}
        {fetchState === 'ready' && contractors.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-brand-near-black">No professionals in this category yet.</p>
            <p className="text-xs text-brand-mid-grey mt-1">Try a different filter.</p>
          </div>
        )}

        {/* Footer note */}
        {fetchState === 'ready' && contractors.length > 0 && (
          <p className="mt-10 text-center text-xs text-brand-mid-grey">
            All listed professionals are screened by the Jalla team.{' '}
            <Link
              to="/contractor-apply"
              className="underline underline-offset-4 hover:text-brand-near-black transition-colors"
            >
              Apply to join the directory
            </Link>
          </p>
        )}
      </div>

      <BackToTop />
    </div>
  );
}
