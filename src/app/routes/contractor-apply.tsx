import { useEffect } from "react";
import { Link } from "react-router";

export default function ContractorApply() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://link.msgsndr.com/js/form_embed.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      try { document.body.removeChild(script); } catch {}
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-brand-border-grey px-7 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-['Playfair_Display'] text-[26px] font-semibold text-brand-near-black">Jalla</span>
          <span className="text-[10px] text-brand-mid-grey tracking-[0.12em]">THE FIRM</span>
        </Link>
        <Link to="/" className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors">
          ← Back to Home
        </Link>
      </nav>

      <div className="max-w-[640px] mx-auto px-6 py-12">
        <h1 className="font-['Playfair_Display'] text-3xl md:text-4xl font-medium text-brand-near-black mb-2">
          Build With Jalla
        </h1>
        <p className="text-brand-mid-grey mb-8 text-sm md:text-base leading-relaxed">
          Apply to join our verified contractor network. We review applications weekly.
        </p>

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
    </div>
  );
}
