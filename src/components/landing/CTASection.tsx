import { motion } from "framer-motion";
import { Link } from "react-router";
import { Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useJoinDestination } from "@/hooks/useJoinDestination";

export default function CTASection() {
  const t = useT();
  const join    = useJoinDestination();
  const knownUs = join !== '/auth/signup';

  return (
    <section id="join" className="bg-brand-near-black py-20 text-center px-5 sm:px-7">
      <div className="max-w-140 mx-auto">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          // Block-level, not inline-flex: the Button renders as an inline-flex anchor,
          // so an inline icon sat on the same line as it once the copy between them went.
          className="flex justify-center text-white mb-8"
        >
          <Home className="size-9" />
        </motion.div>
        {/* Shrink-to-fit column: the wider of the button and the line under it sets the
            width, and the button stretches to match. Centred by the section's
            text-center, so no extra centring is needed on the column itself. */}
        <div className="flex w-full flex-col items-stretch sm:inline-flex sm:w-auto">
        <Button asChild className="w-full bg-white text-brand-near-black font-bold text-sm px-8 h-auto py-4 hover:bg-brand-pale group">
          <Link to={join} className="flex items-center justify-center gap-1.5">
            {t('landing.signup.cta')}
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Button>

        {/* Flips with the button above, for the reason given in HeroSection. */}
        <p className="mt-4 text-xs text-white/50">
          {t(knownUs ? 'landing.signup.newHere' : 'landing.signup.haveAccount')}{' '}
          <Link
            to={knownUs ? '/auth/signup' : '/auth/login'}
            className="font-semibold text-white underline underline-offset-4 hover:text-white/80"
          >
            {t(knownUs ? 'landing.signup.createAccount' : 'landing.signup.logIn')}
          </Link>
        </p>
        </div>

        {/* The second audience, and a real button rather than the fine print it used to be:
            partner recruitment is its own funnel now, not an afterthought under the client
            CTA. Outlined so it reads as the second action, not a competing first one. */}
        <div className="mt-8 flex justify-center">
          <Button
            asChild
            variant="outline"
            className="w-full border-white/25 bg-transparent px-8 py-4 h-auto text-sm font-semibold text-white hover:bg-white/10 hover:text-white sm:w-auto"
          >
            {/* The sign-up page with the contractor option chosen — Philip's point 2.
                Named outright, not derived from `join`, which may be the log-in page
                for a returning browser and would drop the role. */}
            <Link to="/auth/signup?role=contractor" className="flex items-center justify-center gap-1.5">
              {t('landing.cta.contractorLink')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
