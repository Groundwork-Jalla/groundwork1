import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Reveal } from "./Reveal";

const STROKE = "#0A0A0A";

function useScrollTrigger() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return [ref, inView] as const;
}

function PlanScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 160 140" className="w-full h-full" aria-hidden="true">
      <rect x="20" y="15" width="120" height="90" rx="4" fill="white" stroke={STROKE} strokeWidth="1.5" />
      <path
        d="M20,60 H140 M70,15 V60 M70,60 V105 M40,60 V105"
        fill="none"
        stroke={STROKE}
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeDasharray="300"
        strokeDashoffset="300"
      >
        {inView && <animate attributeName="stroke-dashoffset" from="300" to="0" dur="1.2s" fill="freeze" />}
      </path>
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="3.5s" repeatCount="indefinite" />
        <line x1="118" y1="32" x2="138" y2="12" stroke={STROKE} strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="136,10 142,16 138,20 132,14" fill={STROKE} />
      </g>
    </svg>
  );
}

function TrackScene() {
  const [ref, inView] = useScrollTrigger();
  const nodes = [15, 47.5, 80, 112.5, 145];
  return (
    <svg ref={ref} viewBox="0 0 160 140" className="w-full h-full" aria-hidden="true">
      <line x1="15" y1="70" x2="145" y2="70" stroke={STROKE} strokeOpacity="0.15" strokeWidth="2" />
      {nodes.map((cx, i) => {
        if (i < 2)
          return (
            <circle key={i} cx={cx} cy="70" r="7" fill={STROKE} opacity="0">
              {inView && <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin={`${i * 0.15}s`} fill="freeze" />}
            </circle>
          );
        if (i === 2)
          return (
            <circle key={i} cx={cx} cy="70" r="7" fill={STROKE} fillOpacity="0.4">
              <animate attributeName="fill-opacity" values="0.4;0.85;0.4" dur="1.6s" repeatCount="indefinite" />
            </circle>
          );
        return <circle key={i} cx={cx} cy="70" r="7" fill="none" stroke={STROKE} strokeOpacity="0.3" strokeWidth="1.5" />;
      })}
      <polygon points="0,0 6,0 3,6" fill={STROKE} fillOpacity="0.6">
        <animate attributeName="transform" values="translate(15,55);translate(145,55);translate(15,55)" dur="4s" repeatCount="indefinite" />
      </polygon>
    </svg>
  );
}

function VerifyScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 160 140" className="w-full h-full" aria-hidden="true">
      <rect x="35" y="50" width="90" height="60" rx="4" fill="white" stroke={STROKE} strokeWidth="1.5" />
      <rect x="35" y="50" width="90" height="14" rx="4" fill={STROKE} />
      <circle cx="80" cy="90" r="16" fill={STROKE} />
      <path
        d="M72 90 L78 96 L90 82"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="26"
        strokeDashoffset="26"
      >
        {inView && <animate attributeName="stroke-dashoffset" from="26" to="0" dur="0.5s" begin="0.3s" fill="freeze" />}
      </path>
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;4 -4;0 0" dur="4s" repeatCount="indefinite" />
        <circle cx="118" cy="38" r="20" fill="none" stroke={STROKE} strokeWidth="2.5" />
        <line x1="132" y1="52" x2="144" y2="64" stroke={STROKE} strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function PayScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 160 140" className="w-full h-full" aria-hidden="true">
      <circle cx="80" cy="44" r="20" fill="none" stroke={STROKE} strokeOpacity="0.2" strokeWidth="1.5">
        <animate attributeName="r" values="20;25;20" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
      </circle>
      <rect x="68" y="40" width="24" height="18" rx="3" fill={STROKE} />
      <g>
        {inView && (
          <animateTransform attributeName="transform" type="rotate" from="0 72 40" to="-45 72 40" begin="0.5s" dur="0.5s" fill="freeze" />
        )}
        <path d="M72,40 v-8 a8,8 0 1,1 16,0 v8" fill="none" stroke={STROKE} strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g opacity="0">
        {inView && <animate attributeName="opacity" from="0" to="1" begin="1.1s" dur="0.5s" fill="freeze" />}
        <rect x="40" y="85" width="80" height="42" rx="5" fill="none" stroke={STROKE} strokeWidth="2" />
        <circle cx="80" cy="106" r="11" fill="none" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="96" x2="58" y2="96" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="116" x2="58" y2="116" stroke={STROKE} strokeWidth="1.5" />
      </g>
    </svg>
  );
}

const items = [
  { Scene: PlanScene, word: "Plan", desc: "Set the budget and break the build into clear, verifiable stages.", badge: "Floor Plan Set" },
  { Scene: TrackScene, word: "Track", desc: "Watch progress move through every stage and substage in real time.", badge: "Stage 3 of 10" },
  { Scene: VerifyScene, word: "Verify", desc: "An independent check confirms the work before anything moves.", badge: "Verified" },
  { Scene: PayScene, word: "Pay", desc: "Funds release only once proof clears — never before.", badge: "₦ Released" },
];

export default function WhatJallaDoes() {
  return (
    <section className="bg-white py-24 px-7">
      <div className="max-w-[1100px] mx-auto">
        <Reveal className="text-center mb-14">
          <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">WHAT JALLA DOES</span>
          <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black mt-3">
            Four Words. One System.
          </h2>
          <p className="text-brand-mid-grey mt-3 max-w-[480px] mx-auto">
            Everything Jalla does for your build, distilled.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((item, i) => (
            <Reveal key={item.word} delay={i * 0.12}>
              <motion.div
                whileHover={{ y: -6 }}
                className="bg-white rounded-2xl p-7 h-full shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.1)] transition-shadow"
              >
                <div className="relative h-36 mb-5">
                  <item.Scene />
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
                    className="absolute -top-1 right-0 rounded-full bg-brand-near-black text-white text-[10px] font-medium px-2.5 py-1 shadow-[0_4px_14px_rgba(0,0,0,0.18)] whitespace-nowrap"
                  >
                    {item.badge}
                  </motion.div>
                </div>
                <h3 className="font-['Playfair_Display'] text-3xl font-bold text-brand-near-black">{item.word}</h3>
                <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">{item.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>

        {/* Hidden for now until the video is ready. Video embed will go here.
        <Reveal delay={0.3} className="mt-14">
          <div className="rounded-2xl border border-dashed border-brand-border-grey bg-brand-off-white h-[280px] flex items-center justify-center">
            <span className="text-sm text-brand-mid-grey">Video coming soon</span>
          </div>
        </Reveal>
        */}
      </div>
    </section>
  );
}
