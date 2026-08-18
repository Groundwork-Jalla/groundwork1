import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useJoinDestination } from "@/hooks/useJoinDestination";
import HeroScene from "./HeroScene";

export default function HeroSection() {
  const t = useT();
  // One button, two kinds of visitor. See lib/auth/returning-user.ts.
  const join    = useJoinDestination();
  const knownUs = join !== '/auth/signup';

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
          {/* Button and the line under it share a shrink-to-fit column, so the wider of
              the two sets the width and the button stretches to meet it. Measuring the
              sentence and hard-coding a width would hold only for English — the French
              button and its log-in line differ by ~60px. */}
          <div className="mt-8 flex w-full flex-col items-stretch sm:inline-flex sm:w-auto">
          <motion.div
            className="w-full rounded-lg"
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(10,10,10,0.12)",
                "0 0 0 14px rgba(10,10,10,0)",
                "0 0 0 0 rgba(10,10,10,0.12)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <Button asChild className="w-full bg-brand-near-black text-white text-sm font-semibold px-8 py-4 h-auto rounded-lg hover:bg-brand-black group">
              <Link to={join} className="flex items-center justify-center gap-2">
                {t('landing.signup.cta')}
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </Button>
          </motion.div>

          {/* The button guesses; this line is the other door, always. It flips with the
              button so the two never point at the same page — a visitor sent to log-in
              needs "create an account" here, not a second link to log in. */}
          <p className="mt-4 text-xs text-brand-mid-grey">
            {t(knownUs ? 'landing.signup.newHere' : 'landing.signup.haveAccount')}{' '}
            <Link
              to={knownUs ? '/auth/signup' : '/auth/login'}
              className="font-semibold text-brand-near-black underline underline-offset-4 hover:text-brand-black"
            >
              {t(knownUs ? 'landing.signup.createAccount' : 'landing.signup.logIn')}
            </Link>
          </p>
          </div>
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
