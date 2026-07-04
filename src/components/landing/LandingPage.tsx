import LandingNav from "./LandingNav";
import HeroSection from "./HeroSection";
import StatsBar from "./StatsBar";
import WhatJallaDoes from "./WhatJallaDoes";
import ComparisonSection from "./ComparisonSection";
import RiskSection from "./RiskSection";
import PlatformCarousel from "./PlatformCarousel";
import WhyUseJalla from "./WhyUseJalla";
import CTASection from "./CTASection";
import SocialProofFeed from "./SocialProofFeed";
import FooterSection from "./FooterSection";
import SocialProofToast from "./SocialProofToast";

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      <LandingNav />
      <HeroSection />
      <StatsBar />
      <WhatJallaDoes />
      <ComparisonSection />
      <RiskSection />
      <PlatformCarousel />
      <WhyUseJalla />
      <CTASection />
      <SocialProofFeed />
      <FooterSection />
      <SocialProofToast />
    </div>
  );
}
