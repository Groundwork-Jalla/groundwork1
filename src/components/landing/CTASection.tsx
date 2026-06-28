import { motion } from "framer-motion";
import { Link } from "react-router";
import { Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import CountdownClock from "./CountdownClock";

export default function CTASection() {
  return (
    <section id="join" className="bg-white py-20 text-center px-5 sm:px-7">
      <div className="max-w-[560px] mx-auto">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex text-brand-near-black mb-3"
        >
          <Home className="size-9" />
        </motion.div>
        <h2 className="font-['Playfair_Display'] text-3xl sm:text-4xl font-medium text-brand-near-black">
          The New Way of Building in Africa Launches In
        </h2>
        <p className="text-brand-mid-grey mt-4">
          Join the Community of Africans Building in Africa and be one of the first to Access Groundwork By Jalla.
        </p>

        <div className="mt-8">
          <CountdownClock />
        </div>

        <Button asChild className="mt-8 bg-brand-near-black text-white font-bold text-sm px-8 h-auto py-4 hover:bg-brand-black group">
          <Link to="/community" className="flex items-center justify-center gap-1.5">
            Join Community - Free
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Button>

        <div className="mt-4">
          <a
            href="/contractor-apply"
            className="text-xs sm:text-sm text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black transition-colors"
          >
            Are you a Construction Professional?
          </a>
        </div>
      </div>
    </section>
  );
}
