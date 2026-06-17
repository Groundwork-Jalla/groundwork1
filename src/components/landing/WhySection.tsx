import { Reveal } from "./Reveal";

const tags = [
  "A home for retirement",
  "A house for the family",
  "A legacy for your children",
  "A place to finally rest",
  "Years of saving, finally spent",
  "Proof that the years away mattered",
];

export default function WhySection() {
  return (
    <section className="max-w-[720px] mx-auto px-7 py-20 text-center">
      <Reveal>
        <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">WHY PEOPLE BUILD</span>
      </Reveal>
      <Reveal delay={0.05}>
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black mt-3">
          This House Means Something.
        </h2>
      </Reveal>
      <Reveal delay={0.1}>
        <p className="italic text-brand-mid-grey mt-4 max-w-[480px] mx-auto">
          It is not just a building. It is the reason you left, and the reason you'll come back.
        </p>
      </Reveal>
      <Reveal delay={0.2}>
        <div className="flex flex-wrap justify-center gap-3 mt-9">
          {tags.map((tag) => (
            <span
              key={tag}
              className="border border-brand-border-grey rounded-full px-4 py-2 text-sm text-brand-dark-grey cursor-pointer transition-all duration-300 hover:bg-brand-near-black hover:text-white hover:border-brand-near-black"
            >
              {tag}
            </span>
          ))}
        </div>
      </Reveal>
      <Reveal delay={0.3}>
        <p className="italic text-brand-mid-grey mt-9 max-w-[480px] mx-auto">
          Which is exactly why it deserves more than trust alone.
        </p>
      </Reveal>
    </section>
  );
}
