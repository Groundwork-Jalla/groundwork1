import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, ArrowRight, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function CTASection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleJoin() {
    if (!email) return;
    console.log("join request:", email);
    setSubmitted(true);
  }

  return (
    <section id="join" className="bg-white py-20 text-center px-7">
      <div className="max-w-[460px] mx-auto">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex text-brand-near-black mb-3"
        >
          <Home className="size-9" />
        </motion.div>
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black">
          Protect Your Build Before It Starts.
        </h2>
        <p className="text-brand-mid-grey mt-4">
          Join the community of diaspora builders who never lost track of their money.
        </p>

        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "backOut" }}
              className="mt-8 inline-flex items-center gap-2 bg-brand-light-grey text-brand-near-black text-sm font-medium rounded-full px-5 py-2.5"
            >
              <CheckCircle2 className="size-4" />
              You're in. Welcome.
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex max-w-[380px] mx-auto rounded-lg overflow-hidden border-2 border-brand-near-black mt-8"
            >
              <Input
                type="email"
                placeholder="your@email.com"
                className="flex-1 border-none rounded-none focus-visible:ring-0"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button
                onClick={handleJoin}
                className="rounded-none bg-brand-near-black text-white font-bold text-sm px-6 h-auto hover:bg-brand-black group"
              >
                <span className="flex items-center gap-1.5">
                  Join Free
                  <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4">
          <a
            href="/contractor-apply"
            className="text-sm text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black transition-colors"
          >
            Are you a contractor? Apply here →
          </a>
        </div>
      </div>
    </section>
  );
}
