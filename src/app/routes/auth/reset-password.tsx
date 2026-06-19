import { useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
          <Mail className="size-5 text-brand-near-black" />
        </div>
        <h1 className="font-['Playfair_Display'] text-2xl font-medium text-brand-near-black">Check your email</h1>
        <p className="text-sm text-brand-mid-grey mt-2">
          We sent a reset link to <span className="text-brand-near-black">{email}</span>.
        </p>
        <Link to="/auth/login" className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4">
          Back to login
        </Link>
      </motion.div>
    );
  }

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-3xl font-medium text-brand-near-black">Reset password</h1>
      <p className="text-sm text-brand-mid-grey mt-2">We'll email you a link to get back in.</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          {submitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        <Link to="/auth/login" className="text-brand-near-black underline underline-offset-4">
          Back to login
        </Link>
      </p>
    </div>
  );
}
