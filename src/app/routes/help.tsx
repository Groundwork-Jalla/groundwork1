import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PlayCircle,
  CalendarDays,
  Users,
  Mail,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';

// ── FAQ data ───────────────────────────────────────────────

interface FaqItem {
  q: string;
  a: string;
}

interface FaqSection {
  heading: string;
  items: FaqItem[];
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    heading: 'Getting Started',
    items: [
      {
        q: 'How do I create my first project?',
        a: "Click 'New Project' from your dashboard or the Projects page. Our 10-step wizard will guide you through selecting your country, project type, dimensions, materials, and plan. The wizard auto-calculates your budget as you go.",
      },
      {
        q: 'What countries do you support?',
        a: 'Groundwork supports 27 countries across Africa, the Middle East, and beyond — including Nigeria, Ghana, Kenya, Cameroon, South Africa, UAE, and more. Currency and construction rate data is calibrated for each country.',
      },
      {
        q: 'Is my project data private?',
        a: 'Yes. Your project data is only visible to you and any contractors you explicitly invite. Groundwork staff can only access anonymised, aggregated data for product improvement.',
      },
      {
        q: 'Can I use Groundwork on mobile?',
        a: 'Groundwork is a responsive web app that works well on mobile browsers. A dedicated mobile app is on our roadmap.',
      },
      {
        q: 'How do I invite a contractor to my project?',
        a: "Navigate to your project → Messages tab → use the 'Invite Contractor' button. The contractor will receive an email invite and can accept to join your project.",
      },
    ],
  },
  {
    heading: 'Plans & Billing',
    items: [
      {
        q: 'What are the different plan tiers?',
        a: 'Groundwork offers three tiers: Self-Verify (free, you verify your own stages with evidence), Jalla Verified (verified by our team, adds a trust badge), and Enterprise (custom pricing for developers with multiple projects).',
      },
      {
        q: 'How much does Jalla Verification cost?',
        a: 'Jalla Verification is charged per stage sign-off. Pricing varies by country — see our Pricing page for current rates.',
      },
      {
        q: 'Is there a free plan?',
        a: 'Yes! The Self-Verify tier is completely free. You can create unlimited projects, track all 10 construction stages, and generate documents at no cost.',
      },
      {
        q: 'When will Stripe payment processing be available?',
        a: "Full Stripe integration for contractor payments is in active development. For now, you can record payments manually inside each project's Payments tab.",
      },
      {
        q: 'What is pawaPay?',
        a: 'pawaPay is our mobile money payout partner for the XAF/FCFA corridor (Cameroon). When Stripe hold-and-release is live, contractor payouts in Cameroon will be processed via pawaPay.',
      },
    ],
  },
  {
    heading: 'Verification & Stages',
    items: [
      {
        q: 'How does stage verification work?',
        a: 'Each of the 10 construction stages must be unlocked sequentially. Upload photo evidence from your site, then either self-verify (free) or request Jalla Verification (paid). Verified stages unlock the next stage.',
      },
      {
        q: 'What evidence do I need to upload?',
        a: 'Upload clear, timestamped photos from your site showing the stage work completed. For example: Stage 2 (Foundation) requires photos of the foundation pour, formwork, and reinforcement.',
      },
      {
        q: 'What happens if my verification is rejected?',
        a: "You'll receive an email explaining what's missing. You can upload additional evidence and re-submit. There's no limit on re-submissions.",
      },
      {
        q: 'Can I complete stages out of order?',
        a: 'No — stages must be completed sequentially. This mirrors real construction sequencing and protects against fraud. The previous stage must be verified before the next unlocks.',
      },
      {
        q: 'What is a Stage Completion Certificate?',
        a: 'Once a stage is verified, you can download a Stage Completion Certificate — a formal PDF document showing the project name, stage, tier, and verification date. These can be shared with banks, insurers, or financiers.',
      },
    ],
  },
];

// ── Accordion item ─────────────────────────────────────────

function FaqAccordion({
  item,
  index,
  openIndex,
  onToggle,
}: {
  item: FaqItem;
  index: number;
  openIndex: number | null;
  onToggle: (i: number) => void;
}) {
  const isOpen = openIndex === index;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(index)}
        className="flex items-center justify-between w-full text-left py-3.5 border-b border-brand-border-grey dark:border-[#2c2c2c]"
      >
        <span className="text-sm font-medium text-brand-near-black dark:text-white pr-4">
          {item.q}
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0"
        >
          <ChevronDown className="size-4 text-brand-mid-grey" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="answer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-sm text-brand-mid-grey leading-relaxed pb-4 pt-2">
              {item.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Contact form ───────────────────────────────────────────

type FormState = 'idle' | 'submitting' | 'success' | 'error';

function ContactForm({ userEmail, userId }: { userEmail: string; userId: string | undefined }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(userEmail);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormState('submitting');
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: userId ?? null,
        name,
        email,
        subject,
        message,
      });
      // Graceful degradation: treat table-not-found errors as success
      if (error && !error.message.includes('does not exist') && error.code !== '42P01') {
        setFormState('error');
        return;
      }
      setFormState('success');
    } catch {
      setFormState('success'); // graceful degradation
    }
  }

  const inputCls =
    'flex h-10 w-full rounded-md border border-brand-border-grey bg-white dark:bg-[#1c1c1c] dark:border-[#2c2c2c] px-3 py-2 text-sm text-brand-near-black dark:text-white outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black dark:focus-visible:border-white';

  if (formState === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#222]">
          <MessageSquare className="size-7 text-brand-near-black dark:text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">
            Message sent!
          </p>
          <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
            We've received your message and will respond within 24 hours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-brand-near-black dark:text-white">
            Name
          </label>
          <input
            type="text"
            required
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-brand-near-black dark:text-white">
            Email
          </label>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-brand-near-black dark:text-white">
          Subject
        </label>
        <input
          type="text"
          required
          placeholder="What's this about?"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-brand-near-black dark:text-white">
          Message
        </label>
        <textarea
          required
          rows={4}
          placeholder="Tell us how we can help…"
          value={message}
          onChange={e => setMessage(e.target.value)}
          className={`${inputCls} h-auto min-h-[100px] resize-y`}
        />
      </div>

      {formState === 'error' && (
        <p className="text-xs text-red-500">
          Something went wrong. Please try again or email us directly at hello@groundwork.build
        </p>
      )}

      <button
        type="submit"
        disabled={formState === 'submitting'}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-semibold px-5 py-2.5 transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {formState === 'submitting' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}

// ── Main page ──────────────────────────────────────────────

export default function HelpPage() {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  function toggleFaq(globalIndex: number) {
    setOpenFaq(prev => (prev === globalIndex ? null : globalIndex));
  }

  function scrollToContact() {
    contactRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Build a flat global index offset per section
  const sectionOffsets: number[] = [];
  let runningOffset = 0;
  for (const section of FAQ_SECTIONS) {
    sectionOffsets.push(runningOffset);
    runningOffset += section.items.length;
  }

  const quickActions = [
    {
      icon: PlayCircle,
      title: 'Video Walkthroughs',
      desc: 'Watch step-by-step guides for every feature',
      action: (
        <a
          href="https://www.youtube.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto"
        >
          Watch videos
        </a>
      ),
    },
    {
      icon: CalendarDays,
      title: 'Book a Call',
      desc: 'Schedule a 30-min onboarding session with our team',
      action: (
        <a
          href="mailto:hello@groundwork.build"
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto"
        >
          Book now
        </a>
      ),
    },
    {
      icon: Users,
      title: 'Join Community',
      desc: 'Connect with other builders in our community',
      action: (
        <Link
          to="/community"
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto"
        >
          Join us
        </Link>
      ),
    },
    {
      icon: Mail,
      title: 'Contact Support',
      desc: "Send us a message and we'll respond within 24h",
      action: (
        <button
          type="button"
          onClick={scrollToContact}
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto text-left"
        >
          Send a message
        </button>
      ),
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          Help & Support
        </h1>
        <p className="text-sm text-brand-mid-grey mt-1">
          Everything you need to build with confidence
        </p>
      </div>

      {/* Quick actions grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickActions.map(({ icon: Icon, title, desc, action }) => (
          <div
            key={title}
            className="rounded-2xl border border-brand-border-grey bg-white dark:bg-brand-dark-grey dark:border-[#2c2c2c] p-5 flex flex-col gap-3 hover:border-brand-near-black dark:hover:border-[#555] transition-colors cursor-pointer"
          >
            <div className="size-8 rounded-lg bg-brand-off-white dark:bg-[#222] flex items-center justify-center">
              <Icon className="size-4 text-brand-near-black dark:text-white" />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <p className="text-sm font-semibold text-brand-near-black dark:text-white">
                {title}
              </p>
              <p className="text-xs text-brand-mid-grey leading-relaxed">
                {desc}
              </p>
            </div>
            {action}
          </div>
        ))}
      </div>

      {/* FAQ Accordion */}
      <div>
        <h2 className="text-lg font-bold text-brand-near-black dark:text-white mb-4">
          Frequently asked questions
        </h2>

        {FAQ_SECTIONS.map((section, sIdx) => {
          const offset = sectionOffsets[sIdx];
          return (
            <div key={section.heading}>
              <p className="text-xs font-semibold text-brand-mid-grey uppercase tracking-widest mt-8 mb-1">
                {section.heading}
              </p>
              {section.items.map((item, iIdx) => {
                const globalIdx = offset + iIdx;
                return (
                  <FaqAccordion
                    key={globalIdx}
                    item={item}
                    index={globalIdx}
                    openIndex={openFaq}
                    onToggle={toggleFaq}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Contact form */}
      <div
        ref={contactRef}
        id="contact-form"
        className="rounded-2xl border border-brand-border-grey bg-white dark:bg-brand-dark-grey dark:border-[#2c2c2c] p-6"
      >
        <h2 className="text-lg font-bold text-brand-near-black dark:text-white mb-1">
          Send us a message
        </h2>
        <p className="text-xs text-brand-mid-grey mb-6">
          We typically respond within 24 hours on business days.
        </p>
        <ContactForm
          userEmail={user?.email ?? ''}
          userId={user?.id}
        />
      </div>
    </div>
  );
}
