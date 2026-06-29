// TODO: Philip requested fonts match tryjalla.com exactly.
// Currently using Playfair Display + Inter.
// Need to confirm the exact font families from the production site.
// Previously referenced as "SFR" — awaiting font files or family name.
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
