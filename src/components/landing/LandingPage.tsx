import LandingNav from "./LandingNav";
import HeroSection from "./HeroSection";
import StatsBar from "./StatsBar";
import WhatJallaDoes from "./WhatJallaDoes";
import ComparisonSection from "./ComparisonSection";
import RiskSection from "./RiskSection";
import PlatformCarousel from "./PlatformCarousel";
import WhyUseJalla from "./WhyUseJalla";
import CTASection from "./CTASection";
import FooterSection from "./FooterSection";
import SocialProofToast from "./SocialProofToast";
import BackToTop from "@/components/ui/BackToTop";

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <LandingNav />
      <HeroSection />
      <StatsBar />
      <WhatJallaDoes />
      <ComparisonSection />
      <RiskSection />
      <PlatformCarousel />
      <WhyUseJalla />
      <CTASection />
      <FooterSection />
      <SocialProofToast />
      <BackToTop />
    </div>
  );
}
