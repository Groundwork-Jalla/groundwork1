import { useRef } from "react";
import { useInView } from "framer-motion";
import { Reveal } from "@/components/landing/Reveal";

const DARK = "#0A0A0A";
const labels = ["Clear Scope", "Defined Roles", "Right Sequence", "Structured Payments"];

function PipelineScene() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <svg ref={ref} viewBox="0 0 600 220" className="w-full h-auto" style={{ maxWidth: 600 }} aria-hidden="true">
      <line x1="100" y1="160" x2="500" y2="160" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="6 4" />

      <circle cx="100" cy="160" r="26" fill="white" stroke={DARK} strokeWidth="2" />
      <text x="100" y="164" textAnchor="middle" fontSize="9" fontWeight="600" fill={DARK}>CLIENT</text>

      <rect x="270" y="130" width="60" height="60" rx="14" fill={DARK} />
      <text x="300" y="164" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">JALLA</text>
      <rect x="270" y="130" width="60" height="60" rx="14" fill="none" stroke={DARK} strokeWidth="2" opacity="0.4">
        <animate attributeName="width" values="60;72;60" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="height" values="60;72;60" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="x" values="270;264;270" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="y" values="130;124;130" dur="2.6s" repeatCount="indefinite" />
      </rect>

      <circle cx="500" cy="160" r="26" fill="white" stroke={DARK} strokeWidth="2" />
      <text x="500" y="164" textAnchor="middle" fontSize="8" fontWeight="600" fill={DARK}>PROFESSIONAL</text>

      {[0, 1.5].map((delay, i) => (
        <circle key={i} cy="160" r="3.5" fill={DARK}>
          <animate attributeName="cx" values="126;500" dur="3s" begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.7;0.7;0" keyTimes="0;0.1;0.85;1" dur="3s" begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {labels.map((l, i) => {
        const w = l.length * 6.6 + 24;
        const x = 175 + (i % 2) * (w + 14);
        const y = 30 + Math.floor(i / 2) * 34;
        return (
          <g key={l} opacity="0">
            {inView && <animate attributeName="opacity" from="0" to="1" begin={`${i * 0.3}s`} dur="0.5s" fill="freeze" />}
            <rect x={x} y={y} width={w} height="24" rx="12" fill="#F2F2F2" stroke="#E5E5E5" strokeWidth="1" />
            <text x={x + w / 2} y={y + 16} textAnchor="middle" fontSize="10" fontWeight="600" fill={DARK}>
              {l}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function IntroducingJalla() {
  return (
    <section className="bg-brand-off-white px-7 py-20">
      <div className="max-w-[800px] mx-auto text-center">
        <Reveal>
          <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">THE SOLUTION</span>
          <h2 className="font-sans text-3xl md:text-4xl font-bold text-brand-near-black mt-3">
            Jalla is the controlled system that makes diaspora projects run properly.
          </h2>
          <p className="text-brand-mid-grey mt-3 max-w-[520px] mx-auto">
            We connect diaspora clients with verified on-ground professionals. But the real advantage is this:
          </p>
        </Reveal>

        <Reveal delay={0.2} className="mt-8">
          <PipelineScene />
        </Reveal>

        <Reveal delay={0.4}>
          <p className="font-sans text-lg font-semibold text-brand-near-black max-w-[560px] mx-auto mt-6 leading-relaxed">
            Jalla controls the process — so the scope is clear, the roles are defined, the sequence is respected,
            and the payments are structured.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
