import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  async function handleLogout() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-brand-border-grey px-7 py-4 flex items-center justify-between">
        <span className="font-['Playfair_Display'] text-xl font-semibold text-brand-near-black">Jalla</span>
        <Button variant="outline" onClick={handleLogout} className="text-sm">
          Log out
        </Button>
      </nav>

      <div className="max-w-[640px] mx-auto px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="font-['Playfair_Display'] text-3xl font-medium text-brand-near-black">
            Welcome to Groundwork, {user?.email}
          </h1>

          <Link
            to="/projects/new"
            className="mt-8 flex items-center gap-4 rounded-2xl border border-dashed border-brand-border-grey p-6 hover:border-brand-near-black hover:bg-brand-off-white transition-colors group"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-light-grey group-hover:bg-brand-near-black transition-colors">
              <Plus className="size-5 text-brand-near-black group-hover:text-white transition-colors" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-brand-near-black">You have no projects yet.</span>
              <span className="block text-sm text-brand-mid-grey mt-0.5">Create your first project →</span>
            </span>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
