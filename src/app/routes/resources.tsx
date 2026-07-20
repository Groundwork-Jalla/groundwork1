import { BookOpen, FileText, CheckSquare, Video, ExternalLink, HardHat, Building2, Scale } from 'lucide-react';

const RESOURCES = [
  {
    category: 'Guides',
    icon: BookOpen,
    items: [
      { title: 'How to Read a Bill of Quantities (BQ)', desc: 'Understand the document your contractor works from. Learn line items, quantities, and unit rates.', tag: 'Popular' },
      { title: 'Hiring a Contractor: What to Check', desc: 'Verify licenses, past work, and references before signing any agreement.', tag: 'Essential' },
      { title: 'Understanding Build Stages', desc: 'A walkthrough of all 10 construction stages — from foundation to finishing.', tag: null },
      { title: 'Diaspora Builder\'s Checklist', desc: 'What to sort out before you break ground when managing from abroad.', tag: 'New' },
    ],
  },
  {
    category: 'Checklists',
    icon: CheckSquare,
    items: [
      { title: 'Site Visit Checklist', desc: 'Questions to ask and things to photograph every time someone visits your site.', tag: null },
      { title: 'Stage Approval Checklist', desc: 'What to confirm before approving each construction stage on Groundwork.', tag: 'Essential' },
      { title: 'Foundation Inspection Checklist', desc: 'Key items to verify at the most critical stage of any build.', tag: null },
      { title: 'Contractor Payment Milestone Template', desc: 'A ready-to-use payment schedule tied to verified stage completion.', tag: null },
    ],
  },
  {
    category: 'Legal & Finance',
    icon: Scale,
    items: [
      { title: 'Title Deed Verification (Cameroon)', desc: 'Step-by-step guide to confirming land ownership before you build.', tag: 'Important' },
      { title: 'Building Permit Process Overview', desc: 'What permits you need in Cameroon and how long each stage takes.', tag: null },
      { title: 'Currency & Transfer Tips for Diaspora', desc: 'How to move funds from abroad efficiently for construction payments.', tag: null },
    ],
  },
  {
    category: 'Videos',
    icon: Video,
    items: [
      { title: 'Groundwork Walkthrough', desc: 'A 5-minute tour of the platform — how to create a project and invite your contractor.', tag: 'Start here' },
      { title: 'Reading Site Evidence Photos', desc: 'How to evaluate photos uploaded by your contractor for each stage.', tag: null },
    ],
  },
];

const TAG_COLORS: Record<string, string> = {
  Popular:    'bg-blue-50 text-blue-700 border border-blue-200',
  Essential:  'bg-brand-near-black text-white border-transparent',
  New:        'bg-green-50 text-green-700 border border-green-200',
  Important:  'bg-amber-50 text-amber-700 border border-amber-200',
  'Start here': 'bg-purple-50 text-purple-700 border border-purple-200',
};

export default function ResourcesPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-8">

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-brand-near-black">Resources</h2>
        <p className="text-xs text-brand-mid-grey mt-0.5">Guides, checklists, and templates to help you build with confidence</p>
      </div>

      {/* Coming soon notice */}
      <div className="rounded-xl bg-brand-near-black px-5 py-4 flex items-start gap-4">
        <HardHat className="size-5 text-white/70 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-white mb-0.5">Full library coming soon</p>
          <p className="text-xs text-white/55 leading-relaxed">
            We're building out downloadable guides and video walkthroughs. The resources below are previews of what's coming.
          </p>
        </div>
      </div>

      {/* Resource sections */}
      {RESOURCES.map(({ category, icon: Icon, items }) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-4">
            <Icon className="size-4 text-brand-mid-grey" />
            <h3 className="text-sm font-semibold text-brand-near-black">{category}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map(item => (
              <div key={item.title}
                className="bg-white rounded-2xl border border-brand-border-grey p-5 flex flex-col gap-2 hover:border-brand-near-black transition-colors group cursor-default">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-near-black leading-snug">{item.title}</p>
                  {item.tag && (
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${TAG_COLORS[item.tag] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                      {item.tag}
                    </span>
                  )}
                </div>
                <p className="text-xs text-brand-mid-grey leading-relaxed">{item.desc}</p>
                <button type="button"
                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey group-hover:text-brand-near-black transition-colors self-start opacity-50 group-hover:opacity-100">
                  <ExternalLink className="size-3" /> Coming soon
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Suggest a resource */}
      <div className="rounded-2xl border border-brand-border-grey bg-white p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white">
          <Building2 className="size-5 text-brand-mid-grey" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-near-black mb-0.5">Missing something?</p>
          <p className="text-xs text-brand-mid-grey leading-relaxed">
            If there's a guide, template, or checklist you'd find useful, let us know and we'll prioritise it.
          </p>
        </div>
        <a href="mailto:hello@jalla.build"
          className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-brand-border-grey text-sm font-medium text-brand-near-black px-4 py-2 hover:bg-brand-off-white transition-colors">
          <FileText className="size-4" /> Suggest a resource
        </a>
      </div>
    </div>
  );
}
