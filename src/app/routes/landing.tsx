import { useEffect } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase/client";
import LandingPage from "@/components/landing/LandingPage";

export default function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);
  return <LandingPage />;
}
