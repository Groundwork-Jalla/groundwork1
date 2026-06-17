import { Button } from "@/components/ui/button";

export default function LandingNav() {
  return (
    <nav className="sticky top-0 z-50 bg-white/92 backdrop-blur-lg border-b border-brand-border-grey">
      <div className="max-w-[1100px] mx-auto px-7 py-3.5 flex justify-between items-center">
        <div className="flex items-baseline gap-2">
          <span className="font-['Playfair_Display'] text-[26px] font-semibold text-brand-near-black">Jalla</span>
          <span className="text-[10px] text-brand-mid-grey tracking-[0.12em]">THE FIRM</span>
        </div>
        <Button asChild className="bg-brand-near-black text-white hover:bg-brand-black text-xs font-semibold px-6 rounded-md">
          <a href="#join">Join Free →</a>
        </Button>
      </div>
    </nav>
  );
}
