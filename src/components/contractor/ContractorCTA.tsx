import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Clock, Users, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/landing/Reveal";
import { trackEvent } from "@/lib/analytics";
import { useLanguage, type TKey } from "@/lib/i18n";
import ContractorApplicationForm from "./ContractorApplicationForm";

const PERKS: { Icon: typeof CheckCircle2; key: TKey }[] = [
  { Icon: CheckCircle2, key: "contractorApply.cta.perk1" },
  { Icon: Clock,        key: "contractorApply.cta.perk2" },
  { Icon: Users,        key: "contractorApply.cta.perk3" },
  { Icon: Star,         key: "contractorApply.cta.perk4" },
];

export default function ContractorCTA() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  // Auto-dismiss the confirmation toast. The form's own success panel stays put —
  // the toast is the glance-level acknowledgement, not the record of what happened.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  // Analytics fires once per page view. Both the button and the #apply hash route through
  // openForm, and the hash can be re-entered any number of times without a remount.
  const trackedRef = useRef(false);

  const openForm = useCallback(() => {
    if (!trackedRef.current) {
      trackEvent('contractor_applied');
      trackedRef.current = true;
    }
    setOpen(true);
    // scroll to form after it renders
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  /**
   * Open the form when the page is entered at #apply, and when the hash changes to #apply
   * while already here — the nav button on this same page navigates without remounting.
   *
   * Without this, #apply only scrolls to the collapsed section, so every "Apply" link
   * (nav and hero) landed the user on another button instead of the form.
   */
  useEffect(() => {
    const openIfApplyHash = () => {
      if (window.location.hash === '#apply') openForm();
    };
    openIfApplyHash();
    window.addEventListener('hashchange', openIfApplyHash);
    return () => window.removeEventListener('hashchange', openIfApplyHash);
  }, [openForm]);

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
              {t('contractorApply.cta.badge')}
            </motion.div>
            <h2 className="font-sans text-3xl sm:text-4xl font-bold text-white leading-[1.15]">
              {t('contractorApply.cta.title')}
            </h2>
            <p className="text-white/50 mt-3 text-sm sm:text-base max-w-120 mx-auto">
              {t('contractorApply.cta.subtitle')}
            </p>
          </Reveal>

          {/* Perks grid */}
          <Reveal delay={0.1}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
              {PERKS.map(({ Icon, key }, i) => (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 bg-white/6 border border-white/10 rounded-xl px-4 py-3"
                >
                  <Icon className="size-4 text-white/60 shrink-0" />
                  <span className="text-sm text-white/70">{t(key)}</span>
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
                    onClick={openForm}
                    className="bg-white text-brand-near-black hover:bg-brand-pale font-bold text-sm px-10 py-5 h-auto rounded-xl group"
                  >
                    {t('contractorApply.cta.button')}
                    <ArrowRight className="size-4 ml-2 transition-transform duration-200 group-hover:translate-x-1" />
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Application form — revealed on click.
              Native (not a GHL iframe) so it can be translated, branch by role,
              and confirm inline. Submissions land in Supabase and are mirrored
              to GoHighLevel from api/ghl/contractor.ts. */}
          <AnimatePresence>
            {open && (
              <motion.div
                ref={formRef}
                initial={{ opacity: 0, y: 32, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="bg-white rounded-2xl p-5 md:p-8 shadow-[0_24px_60px_rgba(0,0,0,0.4)] text-left"
              >
                <div className="flex items-start justify-between mb-6 pb-4 border-b border-brand-border-grey">
                  <div>
                    <p className="font-sans text-base font-bold text-brand-near-black">
                      {t('contractorApply.cta.formTitle')}
                    </p>
                    <p className="text-xs text-brand-mid-grey mt-0.5">
                      {t('contractorApply.cta.formSubtitle')}
                    </p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-brand-mid-grey hover:text-brand-near-black text-xs underline underline-offset-4 transition-colors shrink-0 ml-4"
                  >
                    {t('common.cancel')}
                  </button>
                </div>

                <ContractorApplicationForm
                  onSuccess={() => setToast(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success toast */}
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-xl bg-brand-near-black text-white px-5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
              >
                <CheckCircle2 className="size-4 shrink-0" />
                <span className="text-xs font-medium">{t('contractorApply.form.successToast')}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="bg-brand-near-black px-7 pb-12 text-center">
        <p className="text-sm italic text-white/40 max-w-[500px] mx-auto leading-relaxed">
          {t('contractorApply.cta.footnote')}
        </p>
      </section>
    </>
  );
}
