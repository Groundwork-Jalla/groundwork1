import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { supabase } from "@/lib/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(error.message);
          return;
        }
        // Send new users (no onboarding_complete flag) to onboarding
        const isNew = !sessionData.user?.user_metadata?.onboarding_complete;
        navigate(isNew ? "/onboarding" : "/dashboard", { replace: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      navigate(session ? "/dashboard" : "/auth/login", { replace: true });
    }
    run();
  }, [navigate]);

  if (error) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">
          Something went wrong
        </h1>
        <p className="text-sm text-brand-mid-grey mt-2">{error}</p>
        <Link to="/auth/login" className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center text-sm text-brand-mid-grey">Signing you in…</div>
  );
}
