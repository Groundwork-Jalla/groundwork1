import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

export default function LossCounter() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setValue((v) => {
        const next = v + 1247;
        if (next >= 48000) {
          clearInterval(interval);
          return 48000;
        }
        return next;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <div ref={ref} className="bg-brand-near-black rounded-2xl p-8 text-center mt-8">
      <div className="text-[11px] text-brand-mid-grey tracking-widest">
        AVERAGE LOSS ON AN UNSTRUCTURED BUILD
      </div>
      <div className="font-['Playfair_Display'] text-5xl font-bold text-white mt-2">
        ${value.toLocaleString()}
      </div>
      <p className="text-sm text-white/40 mt-3">
        That's years of savings. Retirement delayed. Trust broken.
      </p>
      <div className="flex flex-wrap justify-center gap-6 mt-6">
        {["Wasted materials", "Ghost contractors", "Unverified labor", "Rebuilt work"].map((label) => (
          <span key={label} className="text-[11px] text-white/30 border-b border-white/10 pb-1">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
