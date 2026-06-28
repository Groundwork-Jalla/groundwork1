import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Reveal } from "@/components/landing/Reveal";

const DARK = "#0A0A0A";

function useScrollTrigger() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return [ref, inView] as const;
}

function FundedScene() {
  return (
    <svg viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      <rect x="60" y="20" width="100" height="80" rx="6" fill="white" stroke={DARK} strokeWidth="1.5" />
      <circle cx="135" cy="35" r="11" fill={DARK} />
      <path d="M130 35 L134 39 L141 31" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="80" y="40" fontSize="14" fontWeight="700" fill={DARK}>$</text>
      {[55, 67, 79].map((y, i) => (
        <line key={i} x1="72" y1={y} x2={72 + 50 - i * 8} y2={y} stroke={DARK} strokeOpacity="0.4" strokeWidth="1.5" />
      ))}
      <rect x="60" y="112" width="100" height="8" rx="4" fill="none" stroke={DARK} strokeOpacity="0.3" strokeWidth="1" />
      <rect x="60" y="112" width="80" height="8" rx="4" fill={DARK} />
      <motion.g animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <rect x="150" y="100" width="56" height="20" rx="10" fill={DARK} />
        <text x="178" y="113" textAnchor="middle" fontSize="9" fontWeight="700" fill="white">FUNDED</text>
      </motion.g>
    </svg>
  );
}

function PaymentScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      <line x1="20" y1="100" x2="200" y2="100" stroke={DARK} strokeOpacity="0.2" strokeWidth="2" />
      {[20, 110, 200].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy="100" r="9" fill={i < 2 ? DARK : "none"} stroke={DARK} strokeWidth="1.5" />
          {i < 2 && <path d={`M${x - 4} 100 L${x - 1} 103 L${x + 4} 96`} fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      ))}
      <rect x="90" y="25" width="40" height="30" rx="4" fill={DARK} />
      <g>
        {inView && <animateTransform attributeName="transform" type="rotate" from="0 95 25" to="-40 95 25" begin="0.3s" dur="0.5s" fill="freeze" />}
        <path d="M95,25 v-9 a5,5 0 1,1 10,0 v9" stroke={DARK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </g>
      {[0, 0.2].map((d, i) => (
        <circle key={i} cx="110" cy="60" r="3" fill={DARK} opacity="0">
          {inView && (
            <>
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.7;1" begin={`${0.9 + d}s`} dur="1.4s" repeatCount="indefinite" />
              <animate attributeName="cy" values="60;125" begin={`${0.9 + d}s`} dur="1.4s" repeatCount="indefinite" />
              <animate attributeName="cx" values="110;145" begin={`${0.9 + d}s`} dur="1.4s" repeatCount="indefinite" />
            </>
          )}
        </circle>
      ))}
      <rect x="150" y="115" width="36" height="26" rx="4" fill="none" stroke={DARK} strokeWidth="1.5" />
      <circle cx="168" cy="128" r="6" fill="none" stroke={DARK} strokeWidth="1.2" />
    </svg>
  );
}

function StructuredScene() {
  const [ref, inView] = useScrollTrigger();
  const steps = ["Legal", "Survey", "Design", "Build", "Finishing"];
  return (
    <svg ref={ref} viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      <line x1="40" y1="15" x2="40" y2="135" stroke={DARK} strokeOpacity="0.15" strokeWidth="2" />
      {steps.map((s, i) => {
        const y = 15 + i * 30;
        return (
          <g key={s}>
            <circle cx="40" cy={y} r="8" fill="white" stroke={DARK} strokeWidth="1.5" />
            <circle cx="40" cy={y} r="8" fill={DARK} opacity="0">
              {inView && <animate attributeName="opacity" from="0" to="1" begin={`${i * 0.15}s`} dur="0.3s" fill="freeze" />}
            </circle>
            <text x="58" y={y + 4} fontSize="10" fontWeight="600" fill={DARK}>{s}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ProtectionScene() {
  return (
    <svg viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      <path d="M110,20 L160,38 V80 C160,110 138,128 110,135 C82,128 60,110 60,80 V38 Z" fill="none" stroke={DARK} strokeWidth="2" />
      <circle cx="110" cy="75" r="13" fill="none" stroke={DARK} strokeWidth="1.5" />
      <circle cx="110" cy="70" r="5" fill={DARK} />
      <path d="M101 88 a9 9 0 0 1 18 0" fill="none" stroke={DARK} strokeWidth="1.5" />
      {[
        { x: 25, y: 50 },
        { x: 25, y: 100 },
        { x: 195, y: 50 },
        { x: 195, y: 100 },
      ].map((p, i) => (
        <g key={i}>
          <path
            d={`M${p.x} ${p.y} h16 v-8 l6 6 l-6 6 v-4 h-16 z`}
            fill={DARK}
            fillOpacity="0.5"
            transform={p.x < 110 ? `translate(0,0)` : `scale(-1,1) translate(${-2 * p.x - 16},0)`}
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values={p.x < 110 ? "0 0;14 0;0 0" : "0 0;-14 0;0 0"}
              additive="sum"
              dur="2.2s"
              begin={`${i * 0.3}s`}
              repeatCount="indefinite"
            />
          </path>
        </g>
      ))}
    </svg>
  );
}

function GrowthScene() {
  const [ref, inView] = useScrollTrigger();
  const steps = [
    { x: 20, y: 110, h: 20, big: 6 },
    { x: 75, y: 85, h: 45, big: 9 },
    { x: 130, y: 50, h: 80, big: 13 },
  ];
  return (
    <svg ref={ref} viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      {steps.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y={s.y} width="40" height={s.h} fill="none" stroke={DARK} strokeOpacity="0.3" strokeWidth="1.5" />
          <rect x={s.x} y={130 - s.h} width="40" height="0" fill={DARK} fillOpacity="0.08">
            {inView && <animate attributeName="height" from="0" to={s.h} begin={`${i * 0.2}s`} dur="0.5s" fill="freeze" />}
          </rect>
          <circle cx={s.x + 20} cy={s.y - 12} r={s.big} fill="none" stroke={DARK} strokeWidth="1.5" opacity="0">
            {inView && <animate attributeName="opacity" from="0" to="1" begin={`${0.3 + i * 0.2}s`} dur="0.4s" fill="freeze" />}
          </circle>
          {i === 2 && (
            <path d="M130 38 l4 -4 l4 4 m-4 -4 v9" fill="none" stroke={DARK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0">
              {inView && <animate attributeName="opacity" from="0" to="1" begin="0.9s" dur="0.4s" fill="freeze" />}
            </path>
          )}
        </g>
      ))}
      <path d="M40 100 Q90 40 150 25" fill="none" stroke={DARK} strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 3" />
      <polygon points="150,25 142,30 148,35" fill={DARK} fillOpacity="0.5" />
    </svg>
  );
}

function VerifiedScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 220 150" className="w-full h-auto" aria-hidden="true">
      <rect x="50" y="20" width="120" height="100" rx="8" fill="white" stroke={DARK} strokeWidth="1.5" />
      <circle cx="110" cy="60" r="22" fill={DARK} />
      <path
        d="M99 60 L107 68 L122 50"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="34"
        strokeDashoffset="34"
      >
        {inView && <animate attributeName="stroke-dashoffset" from="34" to="0" begin="0.2s" dur="0.6s" fill="freeze" />}
      </path>
      <text x="110" y="95" textAnchor="middle" fontSize="10" fontWeight="700" fill={DARK} letterSpacing="0.1em">VERIFIED</text>
      {Array.from({ length: 16 }, (_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        return (row + col * 2) % 4 < 2 ? <rect key={i} x={62 + col * 6} y={104 + row * 6} width="5" height="5" fill={DARK} /> : null;
      })}
      {[
        { x: 35, y: 30, d: "2.4s" },
        { x: 185, y: 100, d: "2.8s" },
        { x: 190, y: 35, d: "2s" },
      ].map((s, i) => (
        <text key={i} x={s.x} y={s.y} fontSize="12" fill={DARK} opacity="0.5">
          ✦
          <animate attributeName="opacity" values="0.2;0.7;0.2" dur={s.d} repeatCount="indefinite" />
        </text>
      ))}
    </svg>
  );
}

const items = [
  {
    n: "01",
    Scene: FundedScene,
    title: "Access to Funded Diaspora Projects",
    desc: "Work with clients who have real budgets, a clear scope of work, and a structured plan and timeline. No more ‘let's start and see.’",
  },
  {
    n: "02",
    Scene: PaymentScene,
    title: "Reliable Payment System",
    desc: "Funds secured before work begins. Milestone-based releases. Clear approval steps. If you complete the milestone, you get paid.",
  },
  {
    n: "03",
    Scene: StructuredScene,
    title: "Structured Project Environment",
    desc: "You operate inside a coordinated sequence. Defined roles and responsibilities. Clean handoffs between professionals. Everyone knows their part. Work flows.",
  },
  {
    n: "04",
    Scene: ProtectionScene,
    title: "Protection from Client Confusion",
    desc: "Jalla handles client communication, scope clarity, documentation, and coordination between stakeholders. You focus on delivery, not managing the client.",
  },
  {
    n: "05",
    Scene: GrowthScene,
    title: "A Real Pipeline to Grow Your Practice",
    desc: "As you perform well, you get access to more opportunities, higher-value builds, and long-term diaspora client relationships. You stop relying on word-of-mouth alone.",
  },
  {
    n: "06",
    Scene: VerifiedScene,
    title: "Verified Partner Status",
    desc: "Stand out with a Verified badge, priority consideration for high-trust projects, and featured placement in the network.",
  },
];

export default function ValueStack() {
  return (
    <section className="bg-white px-7 py-20">
      <div className="max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <h2 className="font-['Playfair_Display'] text-3xl md:text-4xl font-medium text-brand-near-black">
            What you get.
          </h2>
        </Reveal>

        <div className="flex flex-col gap-6">
          {items.map((item, i) => {
            const illustrationFirst = i % 2 === 0;
            return (
              <Reveal key={item.n} direction={illustrationFirst ? "left" : "right"} delay={i * 0.08}>
                <div
                  className={`bg-white rounded-2xl border border-brand-border-grey overflow-hidden flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.04)] ${
                    illustrationFirst ? "md:flex-row" : "md:flex-row-reverse"
                  }`}
                >
                  <div className="bg-brand-off-white p-7 flex items-center justify-center md:w-[280px] shrink-0">
                    <div className="w-full max-w-[220px]">
                      <item.Scene />
                    </div>
                  </div>
                  <div className="flex-1 p-7 flex flex-col justify-center">
                    <div className="flex items-baseline gap-3">
                      <span className="font-['Playfair_Display'] text-3xl text-brand-border-grey leading-none">{item.n}</span>
                      <h3 className="text-lg font-bold text-brand-near-black">{item.title}</h3>
                    </div>
                    <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
