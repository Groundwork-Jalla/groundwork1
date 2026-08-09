import { useForceLight } from "@/hooks/useForceLight";
import BackToTop from "@/components/ui/BackToTop";
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
  useForceLight();

  return (
    // Navbar comes from routes/_public-layout.tsx. Its contractor button becomes the
    // "#apply" jump on this page — see components/shell/SiteNav.tsx.
    <div className="bg-white overflow-x-clip">

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

      {/* Footer comes from routes/_public-layout.tsx. */}
      <BackToTop />
    </div>
  );
}
