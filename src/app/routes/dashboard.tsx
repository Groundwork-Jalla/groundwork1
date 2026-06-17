import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="font-['Playfair_Display'] text-3xl text-brand-near-black">Dashboard</h1>
      <Button onClick={handleLogout}>Log out</Button>
    </div>
  );
}
