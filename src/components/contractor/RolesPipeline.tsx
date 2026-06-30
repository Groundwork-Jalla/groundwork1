import { useRef } from "react";
import { useInView } from "framer-motion";
import { Scale, Compass, Ruler, HardHat, Zap } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

const roles = [
  { Icon: Scale, label: "Land Lawyers", desc: "Title verification, legal clearance" },
  { Icon: Compass, label: "Surveyors", desc: "Boundaries, site mapping" },
  { Icon: Ruler, label: "Engineers", desc: "Structural design, specs" },
  { Icon: HardHat, label: "Contractors", desc: "Build execution" },
  { Icon: Zap, label: "Electricians", desc: "Final systems, finishing" },
];

export default function RolesPipeline() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section className="bg-brand-off-white px-7 py-20">
      <div className="max-w-[900px] mx-auto text-center">
        <Reveal>
          <h2 className="font-sans text-2xl md:text-3xl font-bold text-brand-near-black">
            One system. One sequence. No isolation.
          </h2>
          <p className="text-sm text-brand-mid-grey mt-3 mb-12">Jalla is not random leads. It's coordinated execution.</p>
        </Reveal>

        <div ref={ref} className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-0">
          {roles.map((r, i) => (
            <div key={r.label} className="flex items-center md:flex-row flex-col">
              <Reveal delay={i * 0.15}>
                <div className="group relative bg-white border-2 border-brand-near-black rounded-xl px-5 py-4 text-center min-w-[120px]">
                  <r.Icon className="size-5 mx-auto text-brand-near-black mb-1.5" />
                  <span className="text-xs font-semibold text-brand-near-black block">{r.label}</span>
                  <span className="hidden md:block text-[10px] text-brand-mid-grey mt-1 max-w-[110px] mx-auto leading-snug opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 top-full pt-1 bg-white">
                    {r.desc}
                  </span>
                </div>
              </Reveal>
              {i < roles.length - 1 && (
                <svg width="40" height="16" viewBox="0 0 40 16" className="md:rotate-0 rotate-90 shrink-0" aria-hidden="true">
                  <line x1="2" y1="8" x2="32" y2="8" stroke="#0A0A0A" strokeWidth="2" strokeDasharray="34" strokeDashoffset="34">
                    {inView && <animate attributeName="stroke-dashoffset" from="34" to="0" begin="0s" dur="0.5s" fill="freeze" />}
                  </line>
                  <polygon points="32,3 38,8 32,13" fill="#0A0A0A" opacity="0">
                    {inView && <animate attributeName="opacity" from="0" to="1" begin="0.3s" dur="0.3s" fill="freeze" />}
                  </polygon>
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
