import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Clock, Users, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/landing/Reveal";

const PERKS = [
  { Icon: CheckCircle2, text: "First access to funded diaspora projects" },
  { Icon: Clock, text: "Payments tied to verified milestones — no chasing" },
  { Icon: Users, text: "Part of a vetted, professional network" },
  { Icon: Star, text: "Founding Partner badge on your profile" },
];

function useGHLScript(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const script = document.createElement("script");
    script.src = "https://link.msgsndr.com/js/form_embed.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      try { document.body.removeChild(script); } catch {}
    };
  }, [active]);
}

export default function ContractorCTA() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useGHLScript(open);

  function handleOpen() {
    setOpen(true);
    // scroll to form after it renders
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  return (
    <>
      <section id="apply" className="bg-brand-near-black px-7 py-20">
        <div className="max-w-170 mx-auto">

          {/* Header */}
          <Reveal className="text-center mb-10">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
              className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-xs font-semibold text-white/70 mb-5"
            >
              <span className="relative flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-50" />
                <span className="relative inline-flex size-2 rounded-full bg-white" />
              </span>
              Accepting Founding Partner Applications
            </motion.div>
            <h2 className="font-sans text-3xl sm:text-4xl font-bold text-white leading-[1.15]">
              Ready to be one of the first?
            </h2>
            <p className="text-white/50 mt-3 text-sm sm:text-base max-w-120 mx-auto">
              Apply to join Jalla's Verified Build Network and get matched to funded diaspora projects that pay on time.
            </p>
          </Reveal>

          {/* Perks grid */}
          <Reveal delay={0.1}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
              {PERKS.map(({ Icon, text }, i) => (
                <motion.div
                  key={text}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 bg-white/6 border border-white/10 rounded-xl px-4 py-3"
                >
                  <Icon className="size-4 text-white/60 shrink-0" />
                  <span className="text-sm text-white/70">{text}</span>
                </motion.div>
              ))}
            </div>
          </Reveal>

          {/* CTA button — hides once form is open */}
          <AnimatePresence>
            {!open && (
              <motion.div
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex justify-center"
              >
                <motion.div
                  animate={{
                    boxShadow: [
                      "0 0 0 0 rgba(255,255,255,0.18)",
                      "0 0 0 18px rgba(255,255,255,0)",
                      "0 0 0 0 rgba(255,255,255,0.18)",
                    ],
                  }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="rounded-xl"
                >
                  <Button
                    onClick={handleOpen}
                    className="bg-white text-brand-near-black hover:bg-brand-pale font-bold text-sm px-10 py-5 h-auto rounded-xl group"
                  >
                    Apply as a Founding Partner
                    <ArrowRight className="size-4 ml-2 transition-transform duration-200 group-hover:translate-x-1" />
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* GHL Form — revealed on click */}
          <AnimatePresence>
            {open && (
              <motion.div
                ref={formRef}
                initial={{ opacity: 0, y: 32, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="bg-white rounded-2xl p-5 md:p-8 shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
              >
                <div className="flex items-center justify-between mb-5 pb-4 border-b border-brand-border-grey">
                  <div>
                    <p className="font-sans text-base font-bold text-brand-near-black">Founding Partner Application</p>
                    <p className="text-xs text-brand-mid-grey mt-0.5">Fill in your details below — takes about 3 minutes.</p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-brand-mid-grey hover:text-brand-near-black text-xs underline underline-offset-4 transition-colors shrink-0 ml-4"
                  >
                    Cancel
                  </button>
                </div>

                <iframe
                  src="https://api.leadconnectorhq.com/widget/form/v5Ezo83OmYTlfxka9UAK"
                  style={{ width: "100%", border: "none", borderRadius: "8px", minHeight: "1078px" }}
                  id="inline-v5Ezo83OmYTlfxka9UAK"
                  data-layout="{'id':'INLINE'}"
                  data-trigger-type="alwaysShow"
                  data-trigger-value=""
                  data-activation-type="alwaysActivated"
                  data-activation-value=""
                  data-deactivation-type="neverDeactivate"
                  data-deactivation-value=""
                  data-form-name="Contractor Form"
                  data-height="1078"
                  data-layout-iframe-id="inline-v5Ezo83OmYTlfxka9UAK"
                  data-form-id="v5Ezo83OmYTlfxka9UAK"
                  title="Contractor Form"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="bg-brand-near-black px-7 pb-12 text-center">
        <p className="text-sm italic text-white/40 max-w-[500px] mx-auto leading-relaxed">
          Jalla is not a job board. It is controlled infrastructure for executing diaspora building projects
          properly, with the right professionals, in the right sequence, with the right safeguards.
        </p>
      </section>
    </>
  );
}
