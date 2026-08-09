import HeroSection from "./HeroSection";
import StatsBar from "./StatsBar";
import WhatJallaDoes from "./WhatJallaDoes";
import ComparisonSection from "./ComparisonSection";
import RiskSection from "./RiskSection";
import PlatformCarousel from "./PlatformCarousel";
import WhyUseJalla from "./WhyUseJalla";
import CTASection from "./CTASection";
import SocialProofToast from "./SocialProofToast";
import BackToTop from "@/components/ui/BackToTop";

// The navbar and footer come from routes/_public-layout.tsx now, shared with
// every other public page — see components/shell/SiteNav.tsx.
export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <HeroSection />
      <StatsBar />
      <WhatJallaDoes />
      <ComparisonSection />
      <RiskSection />
      <PlatformCarousel />
      <WhyUseJalla />
      <CTASection />
      <SocialProofToast />
      <BackToTop />
    </div>
  );
}
