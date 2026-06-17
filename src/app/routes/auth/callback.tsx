import { useEffect } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      navigate(session ? "/dashboard" : "/auth/login", { replace: true });
    });
  }, [navigate]);

  return null;
}
