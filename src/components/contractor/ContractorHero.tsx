import { motion } from "framer-motion";
import { ArrowRight, HardHat, Scale, Compass, Ruler, Zap, Wrench, CheckCircle2 } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";
import { Button } from "@/components/ui/button";

const roles = ["Contractors", "Land Lawyers", "Surveyors", "Engineers", "Electricians", "Plumbers", "Skilled Trades"];

const nodes = [
  { Icon: HardHat, label: "Contractor", x: 50, y: 14.5, float: 3 },
  { Icon: Scale, label: "Lawyer", x: 85, y: 29, float: 4 },
  { Icon: Compass, label: "Surveyor", x: 85, y: 67.7, float: 5 },
  { Icon: Ruler, label: "Engineer", x: 50, y: 83.9, float: 3.5 },
  { Icon: Zap, label: "Electrician", x: 15, y: 67.7, float: 4.5 },
  { Icon: Wrench, label: "Plumber", x: 15, y: 29, float: 5.5 },
];

function NetworkScene() {
  return (
    <div className="relative w-full max-w-[420px] mx-auto aspect-[400/310]">
      <svg viewBox="0 0 400 310" className="w-full h-full" aria-hidden="true">
        {nodes.map((n, i) => {
          const x = (n.x / 100) * 400;
          const y = (n.y / 100) * 310;
          return (
            <g key={i}>
              <line x1="200" y1="155" x2={x} y2={y} stroke="white" strokeOpacity="0.15" strokeWidth="1.5" />
              <circle r="3" fill="white" opacity="0">
                <animate attributeName="cx" values={`200;${x}`} dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                <animate attributeName="cy" values={`155;${y}`} dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.7;0" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
              </circle>
              <circle cx={x} cy={y} r="26" fill="white" fillOpacity="0.06" stroke="white" strokeOpacity="0.25" strokeWidth="1.5" />
            </g>
          );
        })}
        <circle cx="200" cy="155" r="44" fill="white" fillOpacity="0.08" stroke="white" strokeOpacity="0.3" strokeWidth="2">
          <animate attributeName="r" values="44;50;44" dur="3s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.3;0.1;0.3" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="200" cy="155" r="38" fill="white" fillOpacity="0.05" />
      </svg>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="font-['Playfair_Display'] text-sm font-bold text-white">JALLA</div>
        <div className="text-[7px] text-white/50 tracking-[0.1em] mt-0.5">THE NETWORK</div>
      </div>

      {nodes.map((n, i) => (
        <motion.div
          key={i}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: n.float, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <n.Icon className="size-4 text-white/80" />
          <span className="text-[8px] text-white/50 whitespace-nowrap">{n.label}</span>
        </motion.div>
      ))}

      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute right-0 top-[2%] rounded-full bg-white/10 border border-white/20 px-2.5 py-1 text-[9px] font-semibold text-white/70 whitespace-nowrap"
      >
        FOUNDING PARTNER
      </motion.div>

      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute left-[78%] top-[40%] flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[9px] font-semibold text-brand-near-black whitespace-nowrap"
      >
        <CheckCircle2 className="size-2.5" />
        VERIFIED
      </motion.div>
    </div>
  );
}

export default function ContractorHero() {
  return (
    <section className="bg-brand-near-black px-7 py-16 lg:py-24">
      <div className="max-w-[1100px] mx-auto flex flex-col lg:flex-row items-center gap-12">
        <div className="flex-1 w-full">
          <Reveal>
            <span className="inline-block text-[10px] font-semibold text-white/60 bg-white/10 px-3.5 py-1.5 rounded-full tracking-[0.06em] mb-5">
              LIMITED SPOTS · FOUNDING PARTNERS
            </span>
            <h1 className="font-['Playfair_Display'] text-4xl md:text-5xl font-medium text-white leading-[1.12]">
              Become a Founding Partner in Jalla's Verified Build Network
            </h1>
            <p className="text-white/60 text-base md:text-lg leading-relaxed mt-4 max-w-[440px]">
              Get first access to funded diaspora projects. Get paid on time. Grow without chasing clients.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="flex flex-wrap gap-2 mt-6">
              {roles.map((r) => (
                <span
                  key={r}
                  className="border border-white/20 rounded-full px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors cursor-default"
                >
                  {r}
                </span>
              ))}
            </div>

            <motion.div
              className="mt-8 inline-block rounded-lg"
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(255,255,255,0.2)",
                  "0 0 0 14px rgba(255,255,255,0)",
                  "0 0 0 0 rgba(255,255,255,0.2)",
                ],
              }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              <Button asChild className="bg-white text-brand-near-black hover:bg-white/90 text-sm font-bold px-8 py-4 h-auto rounded-lg group">
                <a href="#apply" className="flex items-center gap-2">
                  Apply to Become a Founding Partner
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </a>
              </Button>
            </motion.div>
          </Reveal>
        </div>

        <div className="flex-1 w-full">
          <NetworkScene />
        </div>
      </div>
    </section>
  );
}
