import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { useT, type TKey } from "@/lib/i18n";
import { Reveal } from "./Reveal";

const stats: { valueKey: TKey; labelKey: TKey }[] = [
  { valueKey: "landing.stats.overBudgetValue", labelKey: "landing.stats.overBudgetLabel" },
  { valueKey: "landing.stats.overrunValue",    labelKey: "landing.stats.overrunLabel"    },
  { valueKey: "landing.stats.stagesValue",     labelKey: "landing.stats.stagesLabel"     },
  { valueKey: "landing.stats.checkpointsValue",labelKey: "landing.stats.checkpointsLabel"},
];

function AnimatedStat({ value }: { value: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const match = useMemo(() => value.match(/^(\D*)(\d+)(.*)$/), [value]);
  const target = match ? parseInt(match[2], 10) : 0;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView || !match) return;
    const duration = 1200;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * target));
      if (t < 1) frame = requestAnimationFrame(tick);
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
  const t = useT();

  return (
    <section className="bg-brand-near-black py-10">
      <div className="max-w-275 mx-auto px-4 sm:px-7 grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-6">
        {stats.map((stat, i) => (
          <Reveal key={stat.labelKey} delay={i * 0.15} className="text-center">
            <div className="font-sans text-3xl sm:text-4xl lg:text-5xl font-bold text-white">
              <AnimatedStat value={t(stat.valueKey)} />
            </div>
            <div className="text-xs text-white/50 mt-1">{t(stat.labelKey)}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
