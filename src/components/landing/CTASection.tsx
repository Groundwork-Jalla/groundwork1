import { motion } from "framer-motion";
import { Link } from "react-router";
import { Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import CountdownClock from "./CountdownClock";

export default function CTASection() {
  return (
    <section id="join" className="bg-brand-near-black py-20 text-center px-5 sm:px-7">
      <div className="max-w-140 mx-auto">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex text-white mb-3"
        >
          <Home className="size-9" />
        </motion.div>
        <h2 className="font-sans text-3xl sm:text-4xl font-bold text-white">
          The New Way of Building in Africa Launches In
        </h2>

        <div className="mt-8">
          <CountdownClock variant="light" />
        </div>

        <p className="text-sm sm:text-base text-white/60 mt-8">
          Join the Community of Africans Building in Africa and be one of the first to Access Groundwork By Jalla.
        </p>
        <p className="text-sm text-white/40 mt-2 italic">
          Be the first to know when Groundwork is ready for full launch.
        </p>

        <Button asChild className="mt-8 w-full sm:w-auto bg-white text-brand-near-black font-bold text-sm px-8 h-auto py-4 hover:bg-brand-pale group">
          <Link to="/community" className="flex items-center justify-center gap-1.5">
            Join for Free
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Button>

        <div className="mt-4">
          <a
            href="/contractor-apply"
            className="text-xs sm:text-sm text-white/40 underline underline-offset-4 hover:text-white/70 transition-colors"
          >
            Are you a Construction Professional?
          </a>
        </div>
      </div>
    </section>
  );
}
