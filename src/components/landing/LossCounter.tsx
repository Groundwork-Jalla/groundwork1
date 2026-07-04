import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

const TARGET = 48000;
const DURATION = 2400;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function LossCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - start) / DURATION, 1);
      setValue(Math.round(easeOutCubic(progress) * TARGET));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [inView]);

  return (
    <div ref={ref} className="bg-brand-near-black rounded-2xl p-8 text-center mt-8">
      <div className="text-[11px] text-brand-mid-grey tracking-widest uppercase">
        Average Loss on an Unstructured Build
      </div>
      <div className="font-sans text-5xl font-bold text-white mt-2 tabular-nums">
        $
        <span
          className="inline-block text-left"
          style={{ minWidth: `${(TARGET).toLocaleString().length}ch` }}
        >
          {value.toLocaleString()}
        </span>
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
