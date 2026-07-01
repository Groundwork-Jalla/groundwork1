import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  MapPin,
  Star,
  Phone,
  Mail,
  MessageCircle,
  CheckCircle2,
  Lock,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'enterprise';

interface Contractor {
  id: number;
  name: string;
  trade: string;
  location: string;
  rating: number;
  reviews: number;
  verified: boolean;
  yearsExp: number;
  completedProjects: number;
  specialties: string[];
  bio: string;
  phone: string;
  email: string;
  avatar: string;
}

// ── Static data ────────────────────────────────────────────

const CONTRACTORS: Contractor[] = [
  {
    id: 1,
    name: 'Emeka Okafor',
    trade: 'General Contractor',
    location: 'Lagos, Nigeria',
    rating: 4.9,
    reviews: 23,
    verified: true,
    yearsExp: 12,
    completedProjects: 47,
    specialties: ['Residential', 'Multi-Family'],
    bio: 'Specialises in diaspora-funded residential builds. On-time delivery record.',
    phone: '+234 801 234 5678',
    email: 'emeka@buildng.com',
    avatar: 'EO',
  },
  {
    id: 2,
    name: 'Aisha Conteh',
    trade: 'Structural Engineer',
    location: 'Accra, Ghana',
    rating: 4.8,
    reviews: 18,
    verified: true,
    yearsExp: 9,
    completedProjects: 31,
    specialties: ['Commercial', 'Mixed Use'],
    bio: 'PE-certified structural engineer with diaspora project experience.',
    phone: '+233 20 456 7890',
    email: 'aisha@struct.gh',
    avatar: 'AC',
  },
  {
    id: 3,
    name: 'Chidi Nwosu',
    trade: 'Land Surveyor',
    location: 'Abuja, Nigeria',
    rating: 4.7,
    reviews: 12,
    verified: true,
    yearsExp: 15,
    completedProjects: 62,
    specialties: ['Residential', 'Land Boundary'],
    bio: 'Registered surveyor handling complex urban and peri-urban sites.',
    phone: '+234 803 345 6789',
    email: 'chidi@survey.ng',
    avatar: 'CN',
  },
  {
    id: 4,
    name: 'Fatou Diallo',
    trade: 'Interior Designer',
    location: 'Dakar, Senegal',
    rating: 4.9,
    reviews: 31,
    verified: true,
    yearsExp: 7,
    completedProjects: 28,
    specialties: ['Luxury', 'Premium'],
    bio: 'High-end interiors for premium diaspora builds.',
    phone: '+221 77 234 5678',
    email: 'fatou@intdesign.sn',
    avatar: 'FD',
  },
  {
    id: 5,
    name: 'Kwame Asante',
    trade: 'Electrical Engineer',
    location: 'Kumasi, Ghana',
    rating: 4.6,
    reviews: 9,
    verified: false,
    yearsExp: 8,
    completedProjects: 19,
    specialties: ['Commercial', 'Industrial'],
    bio: 'Certified electrician for commercial and industrial projects.',
    phone: '+233 24 567 8901',
    email: 'kwame@elec.gh',
    avatar: 'KA',
  },
  {
    id: 6,
    name: 'Ngozi Obi',
    trade: 'Quantity Surveyor',
    location: 'Port Harcourt, Nigeria',
    rating: 4.8,
    reviews: 14,
    verified: true,
    yearsExp: 11,
    completedProjects: 39,
    specialties: ['Residential', 'Commercial'],
    bio: 'Expert in cost estimation and budget control for all project types.',
    phone: '+234 805 456 7890',
    email: 'ngozi@qs.ng',
    avatar: 'NO',
  },
];

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

  if (isUnlocked) {
    return (
      <div className="flex flex-wrap gap-2 pt-3 border-t border-brand-border-grey mt-3">
        <a
          href={`tel:${contractor.phone}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <Phone className="size-3 shrink-0" />
          {contractor.phone}
        </a>
        <a
          href={`mailto:${contractor.email}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <Mail className="size-3 shrink-0" />
          {contractor.email}
        </a>
        <a
          href={`https://wa.me/${contractor.phone.replace(/\s+/g, '').replace('+', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black hover:border-brand-near-black hover:bg-brand-off-white transition-colors"
        >
          <MessageCircle className="size-3 shrink-0" />
          WhatsApp
        </a>
      </div>
    );
  }

  // Starter — blurred contact with upgrade overlay
  return (
    <div className="relative pt-3 border-t border-brand-border-grey mt-3">
      {/* Blurred placeholder */}
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
      {/* Overlay badge */}
      <div className="absolute inset-0 flex items-center justify-start pl-0.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
          <Lock className="size-3 shrink-0" />
          Unlock with Pro
        </span>
      </div>
    </div>
  );
}

function ContractorCard({ contractor, plan }: { contractor: Contractor; plan: Plan }) {
  const isUnlocked = plan === 'pro' || plan === 'enterprise';

  return (
    <div className="group flex flex-col rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200">

      {/* Header: avatar + verified */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-white text-sm font-bold tracking-wide select-none">
            {contractor.avatar}
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
        <StarRating rating={contractor.rating} reviews={contractor.reviews} />
      </div>

      {/* Bio */}
      <p className="text-xs text-brand-mid-grey leading-relaxed line-clamp-2 mb-3">
        {contractor.bio}
      </p>

      {/* Stats row */}
      <div className="flex gap-4 mb-3">
        <div>
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">Experience</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{contractor.yearsExp} yrs</p>
        </div>
        <div>
          <p className="text-[10px] text-brand-mid-grey uppercase tracking-wide">Projects</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{contractor.completedProjects}</p>
        </div>
      </div>

      {/* Specialties */}
      <div className="flex flex-wrap gap-1.5 mb-auto">
        {contractor.specialties.map((s) => (
          <SpecialtyPill key={s} label={s} />
        ))}
      </div>

      {/* Contact section (tier-gated) */}
      <ContactSection contractor={contractor} plan={plan} />

      {/* Request Quote CTA */}
      <div className="mt-3">
        {isUnlocked ? (
          <button
            type="button"
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

// ── Plan toggle bar ────────────────────────────────────────

function PlanToggleBar({ plan, onChange }: { plan: Plan; onChange: (p: Plan) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-brand-off-white border border-brand-border-grey px-4 py-2.5 text-xs text-brand-mid-grey">
      <span className="flex items-center gap-1.5 shrink-0">
        <ShieldCheck className="size-3.5 text-brand-mid-grey" />
        <span className="font-medium">Simulating plan:</span>
      </span>
      <div className="flex items-center gap-1">
        {(['starter', 'pro', 'enterprise'] as Plan[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
              plan === p
                ? 'bg-brand-near-black text-white'
                : 'text-brand-mid-grey hover:text-brand-near-black hover:bg-brand-light-grey'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

export default function ContractorsPage() {
  useAuth(); // ensures auth context is available

  const [searchParams] = useSearchParams();
  const initialPlan = (searchParams.get('plan') as Plan) ?? 'starter';
  const validPlans: Plan[] = ['starter', 'pro', 'enterprise'];
  const [plan, setPlan] = useState<Plan>(validPlans.includes(initialPlan) ? initialPlan : 'starter');

  const [activeFilter, setActiveFilter] = useState<FilterKey>('All');

  const visible = CONTRACTORS.filter((c) => matchesFilter(c, activeFilter));

  return (
    <div className="min-h-screen bg-white">

      {/* Top nav */}
      <nav className="border-b border-brand-border-grey px-5 sm:px-8 py-3.5 flex items-center gap-4">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <div className="h-4 w-px bg-brand-border-grey" />
        <span className="font-sans text-lg font-bold text-brand-near-black tracking-tight">
          Groundwork
        </span>
      </nav>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

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

        {/* Demo plan toggle */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="mb-5"
        >
          <PlanToggleBar plan={plan} onChange={setPlan} />
        </motion.div>

        {/* Filter bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
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

        {/* Grid */}
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
                <ContractorCard contractor={contractor} plan={plan} />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>

        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-brand-near-black">No professionals in this category yet.</p>
            <p className="text-xs text-brand-mid-grey mt-1">Try a different filter.</p>
          </div>
        )}

        {/* Footer note */}
        <p className="mt-10 text-center text-xs text-brand-mid-grey">
          All listed professionals are screened by the Jalla team.{' '}
          <Link
            to="/contractor-apply"
            className="underline underline-offset-4 hover:text-brand-near-black transition-colors"
          >
            Apply to join the directory
          </Link>
        </p>
      </div>
    </div>
  );
}
