import { Link } from 'react-router';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// The public footer — every signed-out page.
//
// Promoted from the landing page's FooterSection, with the destination links
// that `pricing` and the tools layout each kept their own copy of folded in.
// =========================================================

const LINKS: { to: string; labelKey: TKey }[] = [
  { to: '/pricing',   labelKey: 'nav.pricing' },
  { to: '/tools',     labelKey: 'nav.freeTools' },
  { to: '/auth/signup', labelKey: 'landing.signup.ctaShort' },
  // Google's OAuth review and Stripe both check these are reachable from the
  // public site, not merely live at their URLs.
  { to: '/privacy',   labelKey: 'legal.privacy' },
  { to: '/terms',     labelKey: 'legal.terms' },
];

const SOCIAL = [
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/jalla-the-firm/',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/jallathefirm',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/jallathefirm',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    ),
  },
];

export function SiteFooter() {
  const t = useT();

  return (
    <footer className="border-t border-brand-border-grey px-4 py-4 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-275 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <GroundworkLogo linkTo="/" />

        <div className="order-last flex w-full flex-wrap items-center gap-4 text-xs text-brand-mid-grey sm:order-0 sm:w-auto">
          {LINKS.map(({ to, labelKey }) => (
            <Link key={to} to={to} className="transition-colors hover:text-brand-near-black">
              {t(labelKey)}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {SOCIAL.map(({ label, href, icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-brand-mid-grey transition-colors hover:text-brand-near-black"
            >
              {icon}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
