import { useRef } from 'react';
import { Link, Navigate } from 'react-router';
import { BookOpen, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { FaqList, ContactBox, type FaqSection } from '@/components/help/HelpPieces';

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

  const sections: FaqSection[] = [
    {
      heading: t('help.faqSections.gettingStarted.heading'),
      items: [
        { q: t('help.faqSections.gettingStarted.q1'), a: t('help.faqSections.gettingStarted.a1') },
        { q: t('help.faqSections.gettingStarted.q2'), a: t('help.faqSections.gettingStarted.a2') },
        { q: t('help.faqSections.gettingStarted.q3'), a: t('help.faqSections.gettingStarted.a3') },
        { q: t('help.faqSections.gettingStarted.q4'), a: t('help.faqSections.gettingStarted.a4') },
      ],
    },
    {
      heading: t('help.faqSections.payments.heading'),
      items: [
        { q: t('help.faqSections.payments.q1'), a: t('help.faqSections.payments.a1') },
        { q: t('help.faqSections.payments.q2'), a: t('help.faqSections.payments.a2') },
        { q: t('help.faqSections.payments.q3'), a: t('help.faqSections.payments.a3') },
        { q: t('help.faqSections.payments.q4'), a: t('help.faqSections.payments.a4') },
      ],
    },
    {
      heading: t('help.faqSections.stages.heading'),
      items: [
        { q: t('help.faqSections.stages.q1'), a: t('help.faqSections.stages.a1') },
        { q: t('help.faqSections.stages.q2'), a: t('help.faqSections.stages.a2') },
        { q: t('help.faqSections.stages.q3'), a: t('help.faqSections.stages.a3') },
        { q: t('help.faqSections.stages.q4'), a: t('help.faqSections.stages.a4') },
        { q: t('help.faqSections.stages.q5'), a: t('help.faqSections.stages.a5') },
      ],
    },
  ];

  const quickActions = [
    {
      icon: BookOpen,
      title: t('help.tiles.resourcesTitle'),
      desc: t('help.tiles.resourcesDesc'),
      action: (
        <Link
          to="/resources"
          className="text-xs font-semibold text-brand-near-black dark:text-white hover:underline mt-auto"
        >
          {t('help.openResources')}
        </Link>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
