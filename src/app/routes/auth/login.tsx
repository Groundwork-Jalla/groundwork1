import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    const isNew = !data.user?.user_metadata?.onboarding_complete;
    navigate(isNew ? "/onboarding" : "/dashboard", { replace: true });
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">Log in</h1>
      <p className="text-sm text-brand-mid-grey mt-2">Welcome back. Pick up where you left off.</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/auth/reset-password" className="text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-brand-near-black bg-brand-light-grey rounded-md px-3 py-2"
          >
            {error}
          </motion.p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Logging in…" : "Log in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-brand-border-grey" />
        <span className="text-xs text-brand-mid-grey">OR</span>
        <div className="h-px flex-1 bg-brand-border-grey" />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block">
            <Button variant="outline" disabled className="w-full cursor-not-allowed opacity-60">
              Continue with Google
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming soon</TooltipContent>
      </Tooltip>

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        Don't have an account?{" "}
        <Link to="/auth/signup" className="text-brand-near-black underline underline-offset-4">
          Sign up
        </Link>
      </p>
    </div>
  );
}
