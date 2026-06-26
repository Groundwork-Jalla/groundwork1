import { Reveal } from "@/components/landing/Reveal";

const DARK = "#0A0A0A";

function ScopeIcon() {
  return (
    <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
      <rect x="14" y="8" width="32" height="44" rx="3" fill="none" stroke={DARK} strokeWidth="1.5" />
      {[18, 26, 34, 42].map((y, i) => (
        <line key={i} x1="20" y1={y} x2={20 + 18 - (i % 2) * 6} y2={y} stroke={DARK} strokeOpacity="0.6" strokeWidth="1.5">
          <animate attributeName="x2" values={`${20 + 18 - (i % 2) * 6};${20 + 18 - ((i + 1) % 2) * 6};${20 + 18 - (i % 2) * 6}`} dur="3s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
        </line>
      ))}
    </svg>
  );
}

function PaymentDelayIcon() {
  return (
    <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
      <circle cx="28" cy="30" r="20" fill="none" stroke={DARK} strokeWidth="1.5" />
      <line x1="28" y1="30" x2="28" y2="16" stroke={DARK} strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 28 30" to="360 28 30" dur="6s" repeatCount="indefinite" />
      </line>
      <line x1="28" y1="30" x2="36" y2="30" stroke={DARK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="46" cy="46" r="10" fill="white" stroke={DARK} strokeWidth="1.5" />
      <text x="46" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill={DARK}>₦</text>
    </svg>
  );
}

function StalledIcon() {
  return (
    <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
      {[
        { x: 6, y: 22 },
        { x: 26, y: 22 },
        { x: 46, y: 22 },
      ].map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width="14" height="14" rx="2" fill="none" stroke={DARK} strokeWidth="1.5" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0.25;0.7" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
        </rect>
      ))}
    </svg>
  );
}

function LateCallIcon() {
  return (
    <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
      <circle cx="28" cy="20" r="9" fill="none" stroke={DARK} strokeWidth="1.5" />
      <path d="M14 50 Q14 32 28 32 Q42 32 42 50" fill="none" stroke={DARK} strokeWidth="1.5" />
      <text x="46" y="20" fontSize="16" fontWeight="700" fill={DARK} opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="y" values="20;12;20" dur="2.4s" repeatCount="indefinite" />
        ?
      </text>
    </svg>
  );
}

function BackAndForthIcon() {
  return (
    <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
      <line x1="8" y1="22" x2="40" y2="22" stroke={DARK} strokeWidth="1.5" />
      <polygon points="40,18 48,22 40,26" fill={DARK}>
        <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />
      </polygon>
      <line x1="52" y1="40" x2="20" y2="40" stroke={DARK} strokeWidth="1.5" />
      <polygon points="20,36 12,40 20,44" fill={DARK}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.8s" repeatCount="indefinite" />
      </polygon>
    </svg>
  );
}

const pains = [
  { Icon: ScopeIcon, text: "Clients show up with unclear scope and changing expectations" },
  { Icon: PaymentDelayIcon, text: "Payments get delayed, negotiated, or ‘handled later’" },
  { Icon: StalledIcon, text: "Projects stall because nobody is coordinating the full sequence" },
  { Icon: LateCallIcon, text: "You get pulled in late and expected to ‘figure it out’" },
  { Icon: BackAndForthIcon, text: "Too much back-and-forth, not enough decisions" },
];

export default function RealitySection() {
  return (
    <section className="bg-white px-7 py-20">
      <div className="max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <h2 className="font-['Playfair_Display'] text-3xl md:text-4xl font-medium text-brand-near-black leading-snug">
            You're great at what you do.
            <br />
            <span className="text-brand-mid-grey">The system around you is broken.</span>
          </h2>
        </Reveal>

        <div>
          {pains.map(({ Icon, text }, i) => (
            <Reveal key={text} direction="left" delay={i * 0.1}>
              <div className="flex items-center gap-5 py-4 border-b border-brand-border-grey">
                <div className="flex-shrink-0 w-12 h-12">
                  <Icon />
                </div>
                <p className="text-sm md:text-base text-brand-dark-grey">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p className="font-['Playfair_Display'] italic text-xl text-brand-mid-grey text-center mt-10">
            You are not the problem. The system is.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
