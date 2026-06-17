import LandingNav from "./LandingNav";
import HeroSection from "./HeroSection";
import StatsBar from "./StatsBar";
import WhySection from "./WhySection";
import RiskSection from "./RiskSection";
import ProtectionSteps from "./ProtectionSteps";
import PlatformCarousel from "./PlatformCarousel";
import ComparisonSection from "./ComparisonSection";
import FitSection from "./FitSection";
import CTASection from "./CTASection";
import FooterSection from "./FooterSection";

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      <LandingNav />
      <HeroSection />
      <StatsBar />
      <WhySection />
      <RiskSection />
      <ProtectionSteps />
      <PlatformCarousel />
      <ComparisonSection />
      <FitSection />
      <CTASection />
      <FooterSection />
    </div>
  );
}
