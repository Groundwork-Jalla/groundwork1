import { Reveal } from "./Reveal";

export default function FooterSection() {
  return (
    <footer className="border-t border-brand-border-grey py-7 text-center">
      <Reveal>
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="font-['Playfair_Display'] text-[15px] font-semibold text-brand-near-black">Groundwork</span>
          <span className="text-[11px] text-brand-mid-grey">by Jalla</span>
        </div>
        <p className="text-[11px] text-brand-mid-grey mt-2">© {new Date().getFullYear()} Groundwork by Jalla. All rights reserved.</p>
      </Reveal>
    </footer>
  );
}
