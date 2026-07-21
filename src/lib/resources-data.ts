export type ResourceCategory = 'Guides' | 'Checklists' | 'Legal & Finance' | 'Videos';

export interface Resource {
  slug: string;
  title: string;
  desc: string;
  category: ResourceCategory;
  stage: number | null;
  tag: string | null;
  readTime: string;
  content: string[];
}

export const STAGE_NAMES: Record<number, string> = {
  1:  'Land & Planning',
  2:  'Foundation',
  3:  'Substructure',
  4:  'Superstructure',
  5:  'Roofing',
  6:  'External Works',
  7:  'Internal Works',
  8:  'Mechanical & Electrical',
  9:  'Finishes',
  10: 'Handover',
};

export const RESOURCES: Resource[] = [
  {
    slug: 'how-to-read-a-bq',
    title: 'How to Read a Bill of Quantities (BQ)',
    desc: 'Understand the document your contractor works from. Learn line items, quantities, and unit rates.',
    category: 'Guides',
    stage: 2,
    tag: 'Popular',
    readTime: '8 min read',
    content: [
      'A Bill of Quantities (BQ) is the master document that breaks your entire build into measurable line items. It is prepared by a quantity surveyor and lists every material, labour task, and piece of work needed to complete your project, alongside estimated quantities and unit rates. For diaspora builders who cannot be on site, the BQ is your single most important financial document.',
      'The BQ is typically organised by construction stage: earthworks and foundation first, then substructure, superstructure, roofing, and so on through to finishes. Each section lists items like "concrete grade 25 — 0.8 m³" or "reinforcement bars 12mm — 1,200 kg". The quantities come from drawings; the unit rates come from local market prices. Your contractor\'s bid is essentially their version of these rates against your surveyor\'s quantities.',
      'Key things to scrutinise: first, check unit rates against current Cameroonian material prices. Steel rebar, cement bags, and timber prices fluctuate with the CFA franc. Second, look at provisional sums — these are lump-sum allowances for work that cannot be precisely measured in advance, like excavation in unknown ground conditions. A contractor who inflates provisional sums has room to overcharge later. Third, check that all quantities match your approved drawings. Any discrepancy could signal scope has been added or removed without your sign-off.',
      'Common red flags in a BQ: item rates that are suspiciously round numbers (a sign of guessing rather than real pricing), material quantities that do not reconcile with the drawing dimensions, and missing items that should clearly be present — like damp-proof membranes or roof tie-down straps. Ask your contractor to walk you through any line item you do not recognise.',
      'For diaspora builders, request the BQ in both English and French if possible, and always ask your quantity surveyor to reconcile the contractor\'s bid against the original BQ before you approve any stage payment. Groundwork\'s stage payment feature is built specifically for this: funds are held until stage completion is verified, so you are never paying in advance for work that has not been done.',
    ],
  },
  {
    slug: 'hiring-a-contractor',
    title: 'Hiring a Contractor: What to Check',
    desc: 'Verify licenses, past work, and references before signing any agreement.',
    category: 'Guides',
    stage: 1,
    tag: 'Essential',
    readTime: '6 min read',
    content: [
      'Hiring the wrong contractor is the single biggest risk in a self-managed build. Unlike buying a property where you can inspect before you commit, a bad contractor causes damage that is expensive to reverse — and in Cameroon, legal recourse is slow and uncertain. Spend the time upfront.',
      'Start with registration. Legitimate general contractors in Cameroon should have a MINTP (Ministry of Public Works) enterprise registration number. Ask to see the physical document. If they cannot produce it, that is a hard stop. For electrical and plumbing sub-contractors, look for trade-specific certifications or a track record working with a recognised developer.',
      'Check references — and actually call them. Ask each reference three questions: Did the contractor finish on time? Were there any cost overruns, and what caused them? Would you hire them again? A contractor who cannot provide three completed-project references from the last two years is a risk. If possible, visit at least one of their completed sites. Check whether the workmanship looks solid: straight lines, level floors, clean joints.',
      'Before signing anything, review the contract carefully. It should specify: the scope of work (reference the BQ explicitly), payment milestones tied to stage completion not calendar dates, a retention of 5–10% held until final sign-off, and a defects liability period of at least 12 months. Avoid contracts where the contractor requests more than 30% upfront — the standard in Cameroon is to pay per completed stage.',
      'On Groundwork, you can invite a verified contractor directly to your project. Groundwork-verified contractors have submitted registration documents and at least two client references. This does not guarantee quality, but it means the basic vetting has been done. Always do your own reference calls regardless.',
    ],
  },
  {
    slug: 'understanding-build-stages',
    title: 'Understanding Build Stages',
    desc: 'A walkthrough of all 10 construction stages — from foundation to finishing.',
    category: 'Guides',
    stage: null,
    tag: null,
    readTime: '12 min read',
    content: [
      'Most residential builds in Cameroon follow a predictable sequence of 10 stages, each with clear start and end criteria. Groundwork tracks your project through these stages so that payments are released only when each phase is verified. Understanding what each stage involves helps you ask the right questions when your contractor submits a completion update.',
      'Stage 1 covers land clearance and planning: site surveys, soil testing, and drawing approvals. Stage 2 is foundation — excavation, formwork, pouring the concrete pad or strip foundation, and allowing adequate curing time. Stage 3 is substructure: the work from the foundation up to ground-floor slab level, including block walls and damp-proof courses. Stage 4 is superstructure: columns, beams, and walls up to roof plate level. Stage 5 is roofing: structural roof frame, covering material, and weatherproofing. Stages 6 through 10 cover external works, internal block work, mechanical and electrical rough-in, finishes, and final handover.',
    ],
  },
  {
    slug: 'diaspora-builders-checklist',
    title: "Diaspora Builder's Checklist",
    desc: 'What to sort out before you break ground when managing from abroad.',
    category: 'Guides',
    stage: null,
    tag: 'New',
    readTime: '5 min read',
    content: [
      'Building from the UK, France, or the US while your site is in Cameroon requires a completely different operating model from local project management. The time zone difference, currency gap, and inability to do surprise site visits mean that every process needs to be more formal, more documented, and more automated than you might otherwise bother with.',
      'Before breaking ground, make sure you have: a land title that has been independently verified (see our Title Deed Verification guide), a full set of approved architectural drawings stamped by a registered architect, a detailed BQ prepared by a quantity surveyor (not your contractor), and a signed contract with milestone-based payment terms. Do not skip any of these, even if your family contact on the ground says it is not necessary.',
      'Set up your communication cadence early. Weekly photo reports from site — with each photo geotagged and timestamped — should be non-negotiable. Agree with your contractor that Groundwork is the official channel for submitting evidence. This creates an audit trail you can refer back to if there is a dispute. Video calls every two weeks with your contractor — not just your family contact — help you maintain a direct relationship.',
      'Currency and payment: decide upfront how you will convert and transfer funds. Exchange rates between GBP, EUR, or USD and XAF can move 5–8% in a quarter. Use a currency specialist such as Wise or OFX rather than a high-street bank for routine transfers. Keep a cash reserve of at least 15% of total project cost in XAF with your trusted local contact for emergency purchases.',
      'Most importantly, build a local team you trust beyond just your contractor: a site engineer or foreman who will represent your interests, and a family member or friend who can make unannounced visits. Groundwork provides the digital oversight layer, but local eyes are irreplaceable.',
    ],
  },
  {
    slug: 'site-visit-checklist',
    title: 'Site Visit Checklist',
    desc: 'Questions to ask and things to photograph every time someone visits your site.',
    category: 'Checklists',
    stage: null,
    tag: null,
    readTime: '3 min read',
    content: [
      'Every site visit is an opportunity to catch problems early. This checklist is designed for your local contact — family member, site engineer, or trusted friend — to use on each visit. The goal is consistent, comparable documentation across every check-in.',
      'On each visit, photograph: the overall site from four compass directions, the most recent concrete pour (showing the surface finish), any newly installed rebar before it is covered, material stockpiles (cement bags stacked correctly and covered, not stored on bare ground), and any drainage or waterproofing work. Upload all photos with notes to Groundwork so they are timestamped and filed against the current stage.',
    ],
  },
  {
    slug: 'stage-approval-checklist',
    title: 'Stage Approval Checklist',
    desc: 'What to confirm before approving each construction stage on Groundwork.',
    category: 'Checklists',
    stage: null,
    tag: 'Essential',
    readTime: '4 min read',
    content: [
      'Stage approval on Groundwork is the moment you confirm that a phase of construction is complete and authorise the corresponding payment milestone. This is the highest-stakes action in the platform — once you approve, funds are released. Never approve based on what your contractor tells you; approve based on what you can verify in the submitted evidence.',
      'Before approving any stage, check: that all substages have been marked complete by the contractor, that photos covering every critical item in that stage have been uploaded (not just one or two wide shots), that materials used match what the BQ specifies (check batch numbers or brand logos visible in photos where possible), and that the progress percentage visible on site is consistent with the stage being declared complete.',
      'If you are using a Groundwork site engineer, their sign-off is a strong signal — but still review the photos yourself. They are checking structural compliance; you are checking that what is in the photos matches what you are paying for. Look for: new concrete that has had adequate curing time before being loaded, reinforcement that is correctly spaced and tied, and walls that are plumb.',
      'When in doubt, request a video call with the contractor while they walk the site. Most contractors are familiar with this for diaspora clients. A contractor who refuses a live walkthrough when you have concerns is a red flag.',
      'If the evidence is insufficient, use the Groundwork rejection feature with a written reason. This creates a formal record that the stage was challenged, which protects you legally and gives the contractor a clear brief for what additional evidence they need to provide.',
    ],
  },
  {
    slug: 'foundation-inspection-checklist',
    title: 'Foundation Inspection Checklist',
    desc: 'Key items to verify at the most critical stage of any build.',
    category: 'Checklists',
    stage: 2,
    tag: null,
    readTime: '5 min read',
    content: [
      'Foundation is the most critical stage of any build. Mistakes here are expensive or impossible to correct later. This checklist should be used by your site engineer or a qualified building inspector before you approve Stage 2 and release the corresponding payment.',
      'Verify the following before approving foundation completion: excavation depth matches the structural engineer\'s specification, the founding soil is competent with no signs of waterlogging or organic matter at foundation level, formwork is correctly positioned and plumb, reinforcement bar size and spacing match the structural drawings, concrete mix records are available (delivery notes if ready-mix was used), curing is in progress with adequate moisture protection, and no premature loading has occurred on fresh concrete.',
    ],
  },
  {
    slug: 'contractor-payment-template',
    title: 'Contractor Payment Milestone Template',
    desc: 'A ready-to-use payment schedule tied to verified stage completion.',
    category: 'Checklists',
    stage: null,
    tag: null,
    readTime: '3 min read',
    content: [
      'A milestone-based payment schedule ties each disbursement to a defined output — not a calendar date, not a verbal assurance. This template provides a starting structure that you can adapt to your specific contract.',
      'Typical milestone breakdown for a residential build: Mobilisation (10% on contract signing, covers setup and initial materials), Foundation Complete (15% on verified completion), Substructure to DPC level (15%), Superstructure to Roof Plate (20%), Roof Carcass and Covering (15%), First Fix M&E and Internal Block Work (10%), Finishes (10%), Practical Completion and Snag Clearance (5%). The final 5% is the retention, held for 6–12 months against defects. Adjust percentages to match your BQ cost breakdown by stage.',
    ],
  },
  {
    slug: 'title-deed-verification',
    title: 'Title Deed Verification (Cameroon)',
    desc: 'Step-by-step guide to confirming land ownership before you build.',
    category: 'Legal & Finance',
    stage: 1,
    tag: 'Important',
    readTime: '7 min read',
    content: [
      'Land fraud is one of the most common and costly risks for diaspora investors building in Cameroon. Multiple people claiming ownership of the same plot is not rare — and if you start building on disputed land, you can lose everything: your construction investment, your materials, and potentially face demolition orders. Title deed verification is not optional.',
      'Cameroon uses two main types of land title: the Titre Foncier (TF), which is the gold standard — a fully registered freehold title issued by the Ministry of Lands — and informal certificates such as an Attestation de Vente, which carry legal risk. Only purchase land that has a Titre Foncier. If you are told "the TF is in progress", treat this as unregistered land and price the risk accordingly.',
      'To verify a Titre Foncier: take the title number to the Regional Delegation of Land Affairs (Délégation Régionale des Domaines) in the region where the land is located. Request an official search of the title register — this service costs a small administrative fee. Confirm that the name on the TF matches the seller\'s national identity card exactly, that there are no encumbrances or disputes registered against the title, and that the plot boundaries on the TF match your physical survey.',
      'Common fraud patterns to watch for: a seller who is reluctant to visit the land authority with you, a TF that shows erasures or corrections, multiple copies of the same TF number in circulation (this happens when a title has been fraudulently duplicated), and boundary descriptions that do not match GPS coordinates when you measure the plot. Hire a licensed surveyor to peg the plot before you sign any sale agreement.',
      'Engage a notaire (notary public) for the actual sale transaction — this is legally required in Cameroon for land transfers. The notaire registers the transfer, which provides additional protection. Budget 3–5% of the land value for notary and registration fees. Never finalise a land purchase with only a private sale agreement between you and the vendor.',
    ],
  },
  {
    slug: 'building-permit-process',
    title: 'Building Permit Process Overview',
    desc: 'What permits you need in Cameroon and how long each stage takes.',
    category: 'Legal & Finance',
    stage: 1,
    tag: null,
    readTime: '5 min read',
    content: [
      'Building without a permit in Cameroon is technically illegal and can result in a stop-work order or demolition notice. In practice, enforcement varies by location — urban areas like Yaoundé and Douala are more strictly monitored than rural plots — but the risk of building on an unpermitted site is real, particularly if you ever want to resell or mortgage the property.',
      'The main permit you need is the Permis de Construire (building permit), issued by the local Urban Council (Communauté Urbaine or Commune) where the land is located. The application requires approved architectural drawings stamped by a registered architect, a copy of the Titre Foncier, a topographic survey of the plot, and a completed application form. Processing time is typically 30–90 days depending on the council and the complexity of the project. Budget 1–2% of construction value for permit fees.',
    ],
  },
  {
    slug: 'currency-transfer-tips',
    title: 'Currency & Transfer Tips for Diaspora',
    desc: 'How to move funds from abroad efficiently for construction payments.',
    category: 'Legal & Finance',
    stage: null,
    tag: null,
    readTime: '4 min read',
    content: [
      'Moving money from the UK, France, Germany, or the US to Cameroon for construction payments involves exchange rate risk, transfer fees, and local receiving-bank delays. Small inefficiencies compound into real losses over a multi-year build. A few structural choices made early can save you thousands.',
      'Use a specialist currency provider rather than your retail bank for amounts above €1,000. Wise offers transparent mid-market rate transfers to Cameroon via UBA or Afriland accounts, with lower fees than most banks. OFX and Western Union Business Solutions offer forward contracts if you want to lock in exchange rates for future stage payments. For very large transfers above €20,000, compare rates directly with forex bureaux in Yaoundé or Douala through your local contact.',
    ],
  },
  {
    slug: 'groundwork-walkthrough',
    title: 'Groundwork Walkthrough',
    desc: 'A 5-minute tour of the platform — how to create a project and invite your contractor.',
    category: 'Videos',
    stage: null,
    tag: 'Start here',
    readTime: '5 min',
    content: [
      'Groundwork is a project management and payment platform built specifically for Cameroon construction, designed for diaspora owners who cannot be on site every day. The platform connects you with your contractor, structures your build into verified stages, and holds your funds in escrow until each stage is confirmed complete.',
      'Getting started takes about 15 minutes. Create your project by entering the basic details: location, project type, number of floors, and your target completion date. Groundwork will then guide you through selecting your service tier — Self-Verify (you review evidence yourself), Jalla Verify (a Groundwork engineer reviews on your behalf), or Jalla Management (full managed service).',
      'Once your project is created, invite your contractor using their email address or phone number. They will receive an invite to join Groundwork and link to your project. From that point, the contractor submits stage updates — photos, videos, notes — directly through the platform. You receive a notification and can approve or request more evidence.',
      'Payments work through the Groundwork payments module. You fund a project wallet at the start or stage by stage, and when you approve a stage, the corresponding milestone payment is released to your contractor\'s mobile money account. You have a complete payment history linked to each verified stage.',
      'If you are on Jalla Verify, a Groundwork-appointed site engineer visits the project at each stage and submits their own independent report before you are asked to approve. This removes the need to assess raw site photos yourself. The Jalla Management tier adds ongoing supervision, contractor coordination, and a dedicated project manager as your single point of contact.',
    ],
  },
  {
    slug: 'reading-site-evidence',
    title: 'Reading Site Evidence Photos',
    desc: 'How to evaluate photos uploaded by your contractor for each stage.',
    category: 'Videos',
    stage: null,
    tag: null,
    readTime: '8 min',
    content: [
      'Your contractor\'s site photos are your primary window into what is actually happening on your build. Learning to read them critically — not just glance at them — is one of the most valuable skills a diaspora builder can develop. Good photos show you the work; mediocre photos hide it.',
      'What to look for in a valid evidence photo: the shot is taken close enough to show workmanship detail rather than just a wide-angle overview, the photo is dated (check the EXIF metadata if you have doubts), and the material or work element is clearly visible and in context with the surrounding structure. Reject any stage where the photos show only long-distance shots of the site or a pile of materials without evidence of installation.',
    ],
  },
  {
    slug: 'roof-types-explained',
    title: 'Roof Types Explained',
    desc: 'Compare aluminum long-span, clay tiles, and concrete flat roofs for Cameroon builds.',
    category: 'Guides',
    stage: 5,
    tag: null,
    readTime: '6 min read',
    content: [
      'Your roof choice affects your budget, build timeline, and long-term maintenance costs. In Cameroon, four roof types dominate residential construction: long-span aluminum sheeting, clay tiles, concrete flat roofs, and shingle (less common, mainly in highland areas with cooler climates).',
      'Long-span aluminum is the most common and cost-effective option. It is lightweight, fast to install, and widely available from local manufacturers. The main downsides are noise during heavy rain and lower thermal performance — the interior heats up more quickly than under a tiled or concrete roof. For a typical 150 m² house, a long-span aluminum roof with trusses costs approximately 3–5 million CFA installed. Clay tiles offer better thermal performance and a more traditional aesthetic, but add significant weight to the roof structure and require a stronger truss design to compensate.',
    ],
  },
];
