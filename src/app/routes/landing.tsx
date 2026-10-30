import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useForceLight } from "@/hooks/useForceLight";
import LandingPage from "@/components/landing/LandingPage";
import { useHomePath } from "@/lib/auth/home-path";

export default function Landing() {
  useForceLight();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  // Their own surface, not the client one. Null while the roles are still being
  // read — redirecting on a half-known role is how somebody lands in the wrong app.
  const home = useHomePath();

  useEffect(() => {
    if (!loading && session && home && home !== "/") {
      navigate(home, { replace: true });
    }
  }, [loading, session, home, navigate]);

  return <LandingPage />;
}
