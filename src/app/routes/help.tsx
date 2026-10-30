import { useRef } from 'react';
import { Navigate } from 'react-router';
import { PlayCircle, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { FaqList, ContactBox, type FaqSection } from '@/components/help/HelpPieces';

// ── FAQ data ───────────────────────────────────────────────

/*
 * The contractor's questions used to live here, chosen by `isContractor`.
 *
 * They have moved to the dictionary and are rendered by `/work/help`, inside the
 * contractor's own shell. Branching the list was never enough: this route sits under
 * the CLIENT layout, so a contractor reading contractor answers was still looking at
 * the client's sidebar. Favour, 30 Oct 2026 — "it must be tailored per role".
 *
 * This page now serves clients only, and sends a contractor to theirs.
 */
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
        q: 'How does my contractor get paid?',
        a: 'Groundwork records what has been funded and authorises each milestone release once a stage is verified; the funds themselves are held and moved by a licensed payment provider. In Cameroon the payout reaches your contractor as mobile money in XAF, so they receive local currency without a bank transfer. Our payment providers are named in the Privacy Policy.',
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

// ── Main page ──────────────────────────────────────────────

export default function HelpPage() {
  const t = useT();
  const { user, isContractor, rolesChecked } = useAuth();
  const contactRef = useRef<HTMLDivElement>(null);

  function scrollToContact() {
    contactRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // A contractor never renders this page, because this page is the client shell.
  // Typing /help is a way in as much as pressing a button is, so the redirect lives
  // on the route rather than only on the button that used to point here.
  //
  // Waiting for `rolesChecked` matters: redirecting on a half-read role is how
  // somebody lands on the wrong surface and has to navigate back.
  if (rolesChecked && isContractor) return <Navigate to="/work/help" replace />;

  const sections: FaqSection[] = FAQ_SECTIONS;

  const quickActions = [
    {
      icon: PlayCircle,
      title: t('help.tiles.videosTitle'),
      desc: t('help.tiles.videosDesc'),
      action: (
        <a
          href="https://www.youtube.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto"
        >
          {t('help.watchVideos')}
        </a>
      ),
    },
    {
      icon: Mail,
      title: t('help.tiles.contactTitle'),
      desc: t('help.tiles.contactDesc'),
      action: (
        <button
          type="button"
          onClick={scrollToContact}
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto text-left"
        >
          {t('help.sendCta')}
        </button>
      ),
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('help.title')}
        </h1>
        <p className="text-sm text-brand-mid-grey mt-1">
          {t('help.subtitle')}
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

      <FaqList sections={sections} />

      <ContactBox innerRef={contactRef} userEmail={user?.email ?? ''} userId={user?.id} />
    </div>
  );
}
