import { useEffect } from "react";
import { Reveal } from "@/components/landing/Reveal";

export default function ContractorCTA() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://link.msgsndr.com/js/form_embed.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      try {
        document.body.removeChild(script);
      } catch {}
    };
  }, []);

  return (
    <>
      <section id="apply" className="bg-brand-near-black px-7 py-20 text-center">
        <Reveal>
          <h2 className="font-sans text-3xl font-bold text-white">Ready to be one of the first?</h2>
          <p className="text-sm text-white/50 mt-3 mb-10">
            Apply to become a Founding Partner in Jalla's Verified Build Network.
          </p>

          <div className="max-w-[640px] mx-auto bg-white rounded-2xl p-6 md:p-8">
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
          </div>
        </Reveal>
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
