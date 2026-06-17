import { Reveal } from "./Reveal";
import LossCounter from "./LossCounter";
import {
  MoneyLeakIcon,
  NoMilestonesIcon,
  NoVerificationIcon,
  NoProofIcon,
  DelaysIcon,
  MisalignedIcon,
} from "./RiskIcons";

const risks = [
  {
    Icon: MoneyLeakIcon,
    title: "Budget Drains Silently",
    description: "Money moves before work happens, and there's no record of where it went.",
    stat: "30%+",
    statLabel: "average overrun",
  },
  {
    Icon: NoMilestonesIcon,
    title: "No Clear Milestones",
    description: "Without defined stages, progress is whatever the contractor says it is.",
    stat: "10",
    statLabel: "stages, undefined",
  },
  {
    Icon: NoVerificationIcon,
    title: "No One Verifies the Work",
    description: "Payments get released on trust, not on confirmed, inspected progress.",
    stat: "1 in 3",
    statLabel: "skip inspection",
  },
  {
    Icon: NoProofIcon,
    title: "No Photo or Video Proof",
    description: "When a dispute happens, there's nothing to show what was actually built.",
    stat: "48%",
    statLabel: "disputes, no evidence",
  },
  {
    Icon: DelaysIcon,
    title: "Costly Delays",
    description: "Without checkpoints, slippage compounds quietly month over month.",
    stat: "3-6mo",
    statLabel: "average slippage",
  },
  {
    Icon: MisalignedIcon,
    title: "Builder & Owner Misaligned",
    description: "You're picturing one thing. The contractor is building another.",
    stat: "67%",
    statLabel: "report miscommunication",
  },
];

export default function RiskSection() {
  return (
    <section className="max-w-[820px] mx-auto px-7 py-20 border-t-2 border-brand-near-black">
      <Reveal className="text-center mb-10">
        <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">IT STARTS SMALL</span>
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black mt-3">
          6 Ways Builds Lose Control.
        </h2>
        <p className="text-brand-mid-grey mt-3 max-w-[480px] mx-auto">
          None of them look dangerous at first. All of them compound.
        </p>
      </Reveal>

      <div>
        {risks.map(({ Icon, title, description, stat, statLabel }, i) => (
          <Reveal key={title} direction="left" delay={i * 0.12}>
            <div className="flex gap-5 py-6 px-5 border-b border-brand-border-grey rounded-lg transition-colors hover:bg-brand-off-white">
              <div className="flex-shrink-0 w-14 h-14 sm:w-[56px] sm:h-[56px] [&_svg]:w-10 [&_svg]:h-10 sm:[&_svg]:w-14 sm:[&_svg]:h-14">
                <Icon />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="font-['Playfair_Display'] text-[28px] text-brand-border-grey">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[15px] font-bold text-brand-near-black">{title}</h3>
                </div>
                <p className="text-sm text-brand-mid-grey mt-1">{description}</p>
                <div className="inline-flex items-center gap-2 bg-brand-pale rounded-full px-3 py-1 mt-3">
                  <span className="font-['Playfair_Display'] text-base font-bold text-brand-near-black">{stat}</span>
                  <span className="text-[11px] text-brand-mid-grey">{statLabel}</span>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <p className="italic text-center text-brand-mid-grey mt-10">
        Once control is lost, it is hard to get back.
      </p>
      <LossCounter />
    </section>
  );
}
