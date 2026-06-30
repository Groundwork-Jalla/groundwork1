import { Link } from "react-router";
import ContractorHero from "@/components/contractor/ContractorHero";
import RealitySection from "@/components/contractor/RealitySection";
import IntroducingJalla from "@/components/contractor/IntroducingJalla";
import FoundingAdvantage from "@/components/contractor/FoundingAdvantage";
import ValueStack from "@/components/contractor/ValueStack";
import RolesPipeline from "@/components/contractor/RolesPipeline";
import FitSection from "@/components/contractor/FitSection";
import HowItWorks from "@/components/contractor/HowItWorks";
import ContractorComparison from "@/components/contractor/ContractorComparison";
import SocialProof from "@/components/contractor/SocialProof";
import ContractorCTA from "@/components/contractor/ContractorCTA";

export default function ContractorApply() {
  return (
    <div className="bg-white overflow-x-hidden">
      <nav className="sticky top-0 z-50 bg-brand-near-black/95 backdrop-blur-lg border-b border-white/10 px-7 py-3.5">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <span className="font-sans text-xl font-semibold text-white">
            Jalla<span className="ml-2 text-[9px] font-sans font-normal text-white/40 tracking-[0.12em]">THE FIRM</span>
          </span>
          <Link to="/" className="text-xs text-white/50 hover:text-white transition-colors">
            ← Back to Home
          </Link>
        </div>
      </nav>

      <ContractorHero />
      <RealitySection />
      <IntroducingJalla />
      <FoundingAdvantage />
      <ValueStack />
      <RolesPipeline />
      <FitSection />
      <HowItWorks />
      <ContractorComparison />
      <SocialProof />
      <ContractorCTA />

      <footer className="border-t border-brand-border-grey py-7 text-center">
        <span className="font-sans text-[15px] font-semibold text-brand-near-black">Jalla</span>
        <span className="text-[8px] text-brand-mid-grey tracking-[0.12em] ml-1.5">THE FIRM</span>
        <p className="text-[11px] text-brand-mid-grey mt-1">
          © {new Date().getFullYear()} Jalla. ·{" "}
          <Link to="/" className="underline">
            Back to Home
          </Link>
        </p>
      </footer>
    </div>
  );
}
