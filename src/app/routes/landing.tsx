import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useForceLight } from "@/hooks/useForceLight";
import LandingPage from "@/components/landing/LandingPage";

export default function Landing() {
  useForceLight();
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, session, navigate]);

  return <LandingPage />;
}
