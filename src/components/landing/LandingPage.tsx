import LandingNav from "./LandingNav";
import HeroSection from "./HeroSection";
import WhatJallaDoes from "./WhatJallaDoes";
import ProtectionSteps from "./ProtectionSteps";
import ComparisonSection from "./ComparisonSection";
import RiskSection from "./RiskSection";
import PlatformCarousel from "./PlatformCarousel";
import WhyUseJalla from "./WhyUseJalla";
import CTASection from "./CTASection";
import FooterSection from "./FooterSection";

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      <LandingNav />
      <HeroSection />
      <WhatJallaDoes />
      <ProtectionSteps />
      <ComparisonSection />
      <RiskSection />
      <PlatformCarousel />
      <WhyUseJalla />
      <CTASection />
      <FooterSection />
    </div>
  );
}
