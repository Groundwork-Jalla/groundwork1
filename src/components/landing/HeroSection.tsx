import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import HeroScene from "./HeroScene";

export default function HeroSection() {
  const t = useT();

  return (
    <section className="bg-white">
      <div className="max-w-275 mx-auto px-4 sm:px-7 py-12 lg:py-24 flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="flex-1 max-w-145 w-full"
        >
          <h1 className="font-sans text-3xl sm:text-4xl lg:text-5xl font-black leading-[1.1]">
            <span className="text-brand-near-black">{t('landing.hero.titleMain')}</span>{" "}
            <span className="text-brand-near-black/40 italic font-bold">{t('landing.hero.titleAccent')}</span>
          </h1>
          <p className="mt-6 text-sm lg:text-base leading-relaxed text-brand-mid-grey max-w-115">
            {t('landing.hero.body')}
          </p>
          <motion.div
            className="mt-8 w-full sm:inline-block sm:w-auto rounded-lg"
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(10,10,10,0.12)",
                "0 0 0 14px rgba(10,10,10,0)",
                "0 0 0 0 rgba(10,10,10,0.12)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <Button asChild className="w-full sm:w-auto bg-brand-near-black text-white text-sm font-semibold px-8 py-4 h-auto rounded-lg hover:bg-brand-black group">
              <Link to="/auth/signup" className="flex items-center justify-center gap-2">
                {t('landing.signup.cta')}
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </Button>
          </motion.div>

          {/* The button can only send everyone to one place, and new accounts are
              what it is for. Returning users need their own way through, so the
              log-in path sits directly under it rather than in the navbar only. */}
          <p className="mt-4 text-xs text-brand-mid-grey">
            {t('landing.signup.haveAccount')}{' '}
            <Link
              to="/auth/login"
              className="font-semibold text-brand-near-black underline underline-offset-4 hover:text-brand-black"
            >
              {t('landing.signup.logIn')}
            </Link>
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
          className="flex-1 w-full max-w-140"
        >
          <HeroScene />
        </motion.div>
      </div>
    </section>
  );
}
