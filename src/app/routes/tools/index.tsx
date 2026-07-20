import { Link } from 'react-router';
import { Calculator, ListChecks, CreditCard, ClipboardList, ArrowRight } from 'lucide-react';

const TOOLS = [
  {
    to: '/tools/budget',
    icon: Calculator,
    title: 'Build Budget Calculator',
    description: 'Estimate your build cost by country, square footage, and finish level. Get an itemised breakdown in seconds.',
    cta: 'Calculate cost',
  },
  {
    to: '/tools/stages',
    icon: ListChecks,
    title: 'Construction Stage Planner',
    description: 'See all 10 stages of construction with typical durations, substages, and budget allocation for each.',
    cta: 'View stages',
  },
  {
    to: '/tools/milestones',
    icon: CreditCard,
    title: 'Payment Milestone Generator',
    description: 'Create a safe, stage-based payment plan for your contractor. Never pay everything upfront.',
    cta: 'Generate plan',
  },
  {
    to: '/tools/tracker',
    icon: ClipboardList,
    title: 'DIY Project Tracker',
    description: 'Track your own build offline. Check off substages, add notes, and monitor overall progress — no account needed.',
    cta: 'Start tracking',
  },
];

export default function ToolsIndex() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      {/* Hero */}
      <div className="mb-14">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-mid-grey mb-3">Free Planning Tools</p>
        <h1 className="text-3xl sm:text-4xl font-black text-brand-near-black dark:text-white leading-tight mb-4">
          Build smarter,<br />before you break ground.
        </h1>
        <p className="text-base text-brand-mid-grey max-w-lg">
          Four free tools for African homebuilders. No account required — just open and use.
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {TOOLS.map(tool => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.to}
              to={tool.to}
              className="group flex flex-col gap-4 rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-6 hover:border-brand-near-black dark:hover:border-[#555] transition-colors"
            >
              <div className="size-10 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] flex items-center justify-center">
                <Icon className="size-5 text-brand-near-black dark:text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{tool.title}</h2>
                <p className="text-xs text-brand-mid-grey leading-relaxed">{tool.description}</p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black dark:text-white group-hover:gap-2.5 transition-all">
                {tool.cta} <ArrowRight className="size-3.5" />
              </span>
            </Link>
          );
        })}
      </div>

      {/* CTA strip */}
      <div className="mt-14 rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Want the full picture?</p>
          <p className="text-xs text-brand-mid-grey">Create a Groundwork account to track your real project with stage approvals, document storage, and contractor coordination.</p>
        </div>
        <Link
          to="/auth/signup"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Get started free
        </Link>
      </div>
    </div>
  );
}
