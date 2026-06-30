import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { Reveal } from "./Reveal";

const stats = [
  { value: "1 in 3", label: "Diaspora builds go over budget" },
  { value: "30%+", label: "Average cost overrun" },
  { value: "10", label: "Verified construction stages" },
  { value: "60+", label: "Substage checkpoints" },
];

function AnimatedStat({ value }: { value: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const match = useMemo(() => value.match(/^(\D*)(\d+)(.*)$/), [value]);
  const target = match ? parseInt(match[2], 10) : 0;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView || !match) return;
    const duration = 900;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setCount(Math.round(progress * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, target, match]);

  if (!match) return <span ref={ref}>{value}</span>;

  return (
    <span ref={ref} className="tabular-nums">
      {match[1]}
      <span className="inline-block text-right" style={{ minWidth: `${String(target).length}ch` }}>
        {count}
      </span>
      {match[3]}
    </span>
  );
}

export default function StatsBar() {
  return (
    <section className="bg-brand-off-white border-y border-brand-border-grey py-10">
      <div className="max-w-[1100px] mx-auto px-7 grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-6">
        {stats.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.15} className="text-center">
            <div className="font-sans text-4xl lg:text-5xl font-bold text-brand-near-black">
              <AnimatedStat value={stat.value} />
            </div>
            <div className="text-xs text-brand-mid-grey mt-1">{stat.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
