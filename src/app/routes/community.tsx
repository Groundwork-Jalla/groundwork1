import { useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { CheckCircle2, Home } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CountdownClock from "@/components/landing/CountdownClock";
import SocialProofFeed from "@/components/landing/SocialProofFeed";

export default function Community() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: emailError } = await supabase.from("waitlist_emails").insert({ email });
    if (emailError) {
      setSubmitting(false);
      setError(emailError.code === "23505" ? "You're already on the list." : emailError.message);
      return;
    }

    await supabase.from("waitlist_members").insert({ name: name || null, location: location || null });

    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="bg-white min-h-screen flex flex-col">
      <nav className="sticky top-0 z-50 bg-[#F5F5F5]/95 backdrop-blur-lg border-b border-brand-border-grey px-5 sm:px-7 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sans text-[17px] font-semibold text-brand-near-black">Groundwork</span>
          <span className="text-[11px] text-brand-mid-grey">by Jalla</span>
        </div>
        <Link to="/" className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors">
          ← Back to Home
        </Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-5 sm:px-7 py-10">
        <div className="max-w-[440px] w-full text-center">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="inline-flex text-brand-near-black mb-4"
          >
            <Home className="size-8" />
          </motion.div>

          <h1 className="font-sans text-3xl sm:text-4xl font-bold text-brand-near-black">
            Groundwork is almost ready.
          </h1>
          <p className="text-brand-mid-grey mt-3 text-sm sm:text-base">
            We're putting the final pieces in place. Join the community to be notified the moment Groundwork is
            ready for full use.
          </p>

          <div className="mt-8">
            <CountdownClock />
          </div>

          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "backOut" }}
              className="mt-8 inline-flex items-center gap-2 bg-brand-light-grey text-brand-near-black text-sm font-medium rounded-full px-5 py-2.5"
            >
              <CheckCircle2 className="size-4" />
              You're on the list. We'll be in touch.
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 mt-8 text-left">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Where are you building? (optional)</Label>
                <Input id="location" type="text" placeholder="e.g. Lagos, Nigeria" value={location} onChange={(e) => setLocation(e.target.value)} />
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

              <Button type="submit" disabled={submitting} className="w-full bg-brand-near-black text-white hover:bg-brand-black">
                {submitting ? "Joining…" : "Join the Community — Free"}
              </Button>
            </form>
          )}
        </div>
      </main>

      <SocialProofFeed />

      <footer className="border-t border-brand-border-grey py-7 text-center">
        <span className="font-sans text-[15px] font-semibold text-brand-near-black">Jalla</span>
        <span className="text-[8px] text-brand-mid-grey tracking-[0.12em] ml-1.5">THE FIRM</span>
        <p className="text-[11px] text-brand-mid-grey mt-1">© {new Date().getFullYear()} Jalla. All rights reserved.</p>
      </footer>
    </div>
  );
}
