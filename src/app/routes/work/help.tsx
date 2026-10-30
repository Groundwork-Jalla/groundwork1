import { Link } from 'react-router';
import { Landmark, Handshake, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { FaqList, ContactBox, type FaqSection } from '@/components/help/HelpPieces';

// =========================================================
// /work/help — the contractor's help page, in the contractor's shell.
//
// Favour, 30 Oct 2026: "the help button on the contractor page must not take them to
// client view … on no account should a contractor account see a client dashboard view
// for any reason no matter the button they click on … it must be tailored per role."
//
// The old Help button pointed at `/help`, which lives under the CLIENT layout. The
// questions had already been branched by role, so the ANSWERS were right — but the
// page around them was the client's sidebar, the client's tabs and the client's
// search box. A contractor pressed Help and was moved into somebody else's product.
//
// Branching harder inside one route could not fix that: the route's shell is decided
// by where it sits in the route tree, not by who is reading it. So this is a second
// page, nested under the /work layout, and `WorkShell` points Help here.
//
// Verification is deliberately absent. It is hidden until the feature is finished,
// and documenting a screen nobody can reach would be worse than saying nothing.
// =========================================================

export default function WorkHelpPage() {
  const t = useT();
  const { user } = useAuth();

  // Built from the dictionary rather than hardcoded. The client FAQ next door is
  // still English-only in both locales; this page was new, so it was cheaper to do
  // it correctly than to add to that debt.
  const sections: FaqSection[] = (['running', 'updates', 'paid', 'client'] as const).map(key => ({
    heading: t(`contractorHelp.${key}.heading`),
    items: (['1', '2', '3'] as const).map(n => ({
      q: t(`contractorHelp.${key}.q${n}`),
      a: t(`contractorHelp.${key}.a${n}`),
    })),
  }));

  // Both tiles point inside /work. A help page that offers a way out of the surface
  // is the bug this page exists to fix.
  const tiles = [
    {
      icon: Landmark,
      title: t('contractorHelp.payoutsTitle'),
      desc:  t('contractorHelp.payoutsDesc'),
      to:    '/work/payouts',
      cta:   t('contractorHelp.payoutsCta'),
    },
    {
      icon: Handshake,
      title: t('contractorHelp.partnerTitle'),
      desc:  t('contractorHelp.partnerDesc'),
      to:    '/work/partner',
      cta:   t('contractorHelp.partnerCta'),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-6 pb-24 sm:px-6 md:pb-8">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('help.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorHelp.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map(({ icon: Icon, title, desc, to, cta }) => (
          <div key={to}
            className="flex flex-col gap-3 rounded-2xl border border-brand-border-grey bg-white p-5 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-brand-dark-grey dark:hover:border-[#555]">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand-off-white dark:bg-[#222]">
              <Icon className="size-4 text-brand-near-black dark:text-white" aria-hidden />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <p className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</p>
              <p className="text-xs leading-relaxed text-brand-mid-grey">{desc}</p>
            </div>
            <Link to={to} className="mt-auto text-xs font-semibold text-brand-near-black hover:underline dark:text-white">
              {cta}
            </Link>
          </div>
        ))}

        <div className="flex flex-col gap-3 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-brand-dark-grey">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand-off-white dark:bg-[#222]">
            <Mail className="size-4 text-brand-near-black dark:text-white" aria-hidden />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">
              {t('contractorHelp.contactTitle')}
            </p>
            <p className="text-xs leading-relaxed text-brand-mid-grey">
              {t('contractorHelp.contactDesc')}
            </p>
          </div>
          <a href="#contact-form" className="mt-auto text-xs font-semibold text-brand-near-black hover:underline dark:text-white">
            {t('help.sendCta')}
          </a>
        </div>
      </div>

      <FaqList sections={sections} />

      <ContactBox userEmail={user?.email ?? ''} userId={user?.id} />
    </div>
  );
}
