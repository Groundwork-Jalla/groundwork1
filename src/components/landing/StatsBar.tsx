import { Reveal } from "./Reveal";

const stats = [
  { value: "1 in 3", label: "Diaspora builds go over budget" },
  { value: "30%+", label: "Average cost overrun" },
  { value: "10", label: "Verified construction stages" },
  { value: "60+", label: "Substage checkpoints" },
];

export default function StatsBar() {
  return (
    <section className="bg-brand-off-white border-y border-brand-border-grey py-10">
      <div className="max-w-[1100px] mx-auto px-7 grid grid-cols-2 lg:flex lg:justify-center gap-y-8 gap-x-6 lg:gap-20">
        {stats.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.15} className="text-center">
            <div className="font-['Playfair_Display'] text-4xl lg:text-5xl font-bold text-brand-near-black">
              {stat.value}
            </div>
            <div className="text-xs text-brand-mid-grey mt-1">{stat.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
