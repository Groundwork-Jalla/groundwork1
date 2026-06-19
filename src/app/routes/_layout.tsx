import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedLayout() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      navigate("/auth/login", { replace: true });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  return <Outlet />;
}
