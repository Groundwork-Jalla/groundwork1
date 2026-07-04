import { Youtube, Instagram, Linkedin, Twitter } from "lucide-react";
import { Reveal } from "./Reveal";

// TODO: Replace with confirmed URLs from Philip / Collin
const SOCIAL_LINKS = [
  { icon: Youtube,   href: "https://youtube.com/@jallathefirm",         label: "YouTube" },
  { icon: Instagram, href: "https://instagram.com/jallathefirm",        label: "Instagram" },
  { icon: Linkedin,  href: "https://linkedin.com/company/jallathefirm", label: "LinkedIn" },
  { icon: Twitter,   href: "https://twitter.com/jallathefirm",          label: "Twitter / X" },
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
          {SOCIAL_LINKS.map(({ icon: Icon, href, label }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              <Icon className="size-4.5" strokeWidth={1.75} />
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
