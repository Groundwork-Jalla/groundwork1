import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { supabase } from "@/lib/supabase/client";

export default function ProtectedLayout() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth/login", { replace: true });
        return;
      }
      setChecked(true);
    });
  }, [navigate]);

  if (!checked) return null;

  return <Outlet />;
}
