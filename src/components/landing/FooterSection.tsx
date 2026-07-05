import { Reveal } from "./Reveal";

// TODO: Replace placeholder hrefs with confirmed URLs from Philip / Collin
const SOCIAL_LINKS = [
  {
    label: "YouTube",
    href: "https://youtube.com/@jallathefirm",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/jallathefirm",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/company/jallathefirm",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },
  {
    label: "Twitter / X",
    href: "https://twitter.com/jallathefirm",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

export default function FooterSection() {
  return (
    <footer className="border-t border-brand-border-grey py-8 text-center px-7">
      <Reveal>
        <div className="flex flex-col items-center leading-none mb-5">
          <span className="font-sans text-[17px] font-black text-brand-near-black tracking-tight">Groundwork</span>
          <span className="text-[11px] text-brand-mid-grey font-normal mt-0.5">by Jalla</span>
        </div>

        <div className="flex items-center justify-center gap-5 mb-5">
          {SOCIAL_LINKS.map(({ label, href, icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              {icon}
            </a>
          ))}
        </div>

        <p className="text-[11px] text-brand-mid-grey">
          © {new Date().getFullYear()} Groundwork by Jalla. All rights reserved.
        </p>
      </Reveal>
    </footer>
  );
}
