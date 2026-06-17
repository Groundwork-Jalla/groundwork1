import { motion } from "framer-motion";
import { Home, Building, Building2, Camera, Check, HardHat, Lock } from "lucide-react";

export function CreateProjectSlide() {
  const dots = Array.from({ length: 8 }, (_, i) => i < 3);
  const options = [
    { Icon: Home, label: "House", selected: true },
    { Icon: Building, label: "Duplex", selected: false },
    { Icon: Building2, label: "Apartment", selected: false },
  ];

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-6 w-full max-w-[360px] shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="flex gap-1.5 mb-5">
        {dots.map((filled, i) => (
          <motion.span
            key={i}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: filled ? 1 : 0.3 }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className={`h-1.5 flex-1 rounded-full origin-left ${filled ? "bg-brand-near-black" : "bg-brand-border-grey"}`}
          />
        ))}
      </div>
      <h4 className="text-sm font-semibold text-brand-near-black mb-4">What type of building?</h4>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {options.map((opt) => (
          <motion.div
            key={opt.label}
            animate={
              opt.selected
                ? {
                    boxShadow: [
                      "0 0 0 0 rgba(10,10,10,0.25)",
                      "0 0 0 6px rgba(10,10,10,0)",
                      "0 0 0 0 rgba(10,10,10,0.25)",
                    ],
                  }
                : undefined
            }
            transition={{ duration: 2.2, repeat: Infinity }}
            className={`rounded-lg border p-3 text-center ${
              opt.selected ? "border-brand-near-black bg-brand-near-black text-white" : "border-brand-border-grey text-brand-mid-grey"
            }`}
          >
            <opt.Icon className="size-4 mx-auto" />
            <div className="text-[10px] mt-1">{opt.label}</div>
          </motion.div>
        ))}
      </div>
      <div className="bg-brand-near-black text-white text-center text-xs font-semibold rounded-lg py-2.5">
        Continue
      </div>
    </div>
  );
}

export function UploadProofSlide() {
  return (
    <div className="relative w-[200px] mx-auto">
      <div className="rounded-[28px] border-[6px] border-brand-near-black bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.1)]">
        <div className="h-2 w-12 bg-brand-near-black rounded-full mx-auto mb-3" />
        <div className="relative bg-brand-pale rounded-lg h-24 flex items-center justify-center mb-3 overflow-hidden">
          <Camera className="size-7 text-brand-near-black" />
          <motion.div
            animate={{ opacity: [0, 0.7, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 bg-white"
          />
        </div>
        <div className="flex items-center justify-between bg-brand-off-white rounded-md px-2 py-1.5 mb-2">
          <span className="text-[10px] text-brand-near-black">Excavation</span>
          <motion.span
            animate={{ scale: [0, 1, 1, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.2, 0.8, 1] }}
            className="flex"
          >
            <Check className="size-3 text-brand-near-black" />
          </motion.span>
        </div>
        <div className="flex items-center justify-between bg-white border border-brand-border-grey rounded-md px-2 py-1.5">
          <span className="text-[10px] font-semibold text-brand-near-black">Blinding</span>
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-brand-mid-grey"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-brand-mid-grey">
        <HardHat className="size-3.5" />
        Contractor, On Site
      </div>
    </div>
  );
}

export function VerifySlide() {
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey w-full max-w-[340px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="bg-brand-near-black text-white text-center text-xs font-semibold py-3 tracking-widest">
        JALLA VERIFIED
      </div>
      <div className="p-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, ease: "backOut" }}
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-near-black text-white"
        >
          <Check className="size-6" />
        </motion.div>
        <p className="text-sm font-semibold text-brand-near-black">Stage 3 — Foundation</p>
        <p className="text-[11px] text-brand-mid-grey mt-1">Verified on site, 14 Jun 2026</p>
        <div className="relative w-[68px] h-[68px] mx-auto mt-4 overflow-hidden">
          <div className="grid grid-cols-5 gap-0.5">
            {Array.from({ length: 25 }, (_, i) => (
              <span key={i} className={`h-3 w-3 ${(i * 7) % 5 < 2 ? "bg-brand-near-black" : "bg-white"}`} />
            ))}
          </div>
          <motion.div
            animate={{ y: [-4, 72, -4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute left-0 top-0 w-full h-1 bg-white/60"
          />
        </div>
        <p className="text-[10px] text-brand-mid-grey mt-3 tracking-wider">TOKEN #JLA-48213</p>
      </div>
    </div>
  );
}

export function PaymentSlide() {
  const stages = [true, true, true, false, false];
  return (
    <div className="w-full max-w-[360px]">
      <div className="flex items-center justify-between mb-4">
        {stages.map((released, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: i * 0.15 }}
            className="flex flex-col items-center gap-1.5"
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                released ? "bg-brand-near-black text-white" : "bg-brand-light-grey text-brand-mid-grey border border-brand-border-grey"
              }`}
            >
              {released ? <Check className="size-4" /> : <Lock className="size-4" />}
            </div>
            <span className="text-[9px] text-brand-mid-grey">{released ? "RELEASED" : "HELD"}</span>
          </motion.div>
        ))}
      </div>
      <div className="bg-brand-near-black rounded-xl p-4 text-center">
        <p className="text-xs font-semibold text-white">No Proof = No Payment</p>
      </div>
    </div>
  );
}
