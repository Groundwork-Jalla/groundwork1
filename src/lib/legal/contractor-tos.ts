// Groundwork Contractor Platform Terms of Service — the document Philip supplied on
// 27 October 2026, transcribed verbatim.
//
// ── Why this exists when 117 said one document was enough ───────────────────────────
// 117 removed `terms_of_service` as a signable document, and its reasoning was sound at
// the time: the Terms of Service then on file were the CLIENT's contract, and a
// contractor is not that person. This is a different document with the same name — it
// governs STANDARD CONTRACTOR ACCESS, and §5 says in terms that holding a Contractor
// Account is not Partner status.
//
// That is the split 117 could not make, because the only contractor-facing document in
// existence was the Partner Agreement. Every contractor had to sign the partner terms
// to finish onboarding, which is why 62 people hold a signature on a document promising
// partner compensation. This document is what a contractor who is not a partner should
// have been signing instead.
//
// ── Changing it ─────────────────────────────────────────────────────────────────────
// Do not reword. This is the text a contractor signs, and the signature records the
// version from `current_agreement_version('terms_of_service')`. If the document changes,
// regenerate this file AND bump that version in a migration, so everybody is asked
// again — §23 reserves exactly that right for a material change.
//
// §29 of the source is marked internal and is NOT part of the body below. It specifies
// the acceptance statement, which is exported separately as ACCEPTANCE_STATEMENT and
// must appear beside the unchecked control.

import type { AgreementLine } from './partner-agreement';

/** Shown as the document's name wherever it is read or signed. */
export const TOS_TITLE = 'Groundwork Contractor Platform Terms of Service';

/** Must match `current_agreement_version('terms_of_service')` in the database. */
export const TOS_VERSION = '2026-10-23';

/** The effective date printed in the document itself. */
export const TOS_EFFECTIVE_DATE = 'October 23, 2026';

/**
 * §29, which the source marks internal: this must appear immediately beside the
 * unchecked acceptance control. It is the statement the typed name signs.
 */
export const ACCEPTANCE_STATEMENT =
  'I have read and agree to the Groundwork Contractor Platform Terms of Service and ' +
  'acknowledge the Contractor Privacy Notice. I understand that creating a Contractor ' +
  'Account does not make me a Jalla Partner, Certified Partner, verified professional, ' +
  'employee, agent, or guaranteed recipient of clients or compensation. By checking ' +
  'this box and typing my full legal name, I intend to sign the Terms electronically.';

export const CONTRACTOR_TOS: readonly AgreementLine[] = [
  ['p', 'Terms governing standard contractor access to and use of the Groundwork platform'],
  ['p', 'Effective date: October 23, 2026'],
  ['p', 'Version: 1.0'],
  ['p', 'Provider: Jalla Technologies Inc. doing business as Jalla and Groundwork by Jalla'],
  ['p', 'Please read these Terms carefully. If you accept them, create or use a Contractor Account, or access Groundwork as a contractor, you agree to these legally binding terms.'],

  ['h2', '1. Agreement and scope'],
  ['p', 'These Groundwork Contractor Platform Terms of Service (the "Terms") form a binding agreement between Jalla Technologies Inc., a Maryland corporation doing business as Jalla and Groundwork by Jalla ("Jalla," "we," "us," or "our"), and the individual or entity accepting these Terms ("Contractor," "you," or "your"). These Terms govern your access to and use of Groundwork, including its websites, applications, project-management features, communications, records, payment-related features, professional profiles, and related services (collectively, the "Platform").'],
  ['p', 'If you accept these Terms for a company or other organization, you represent that you have authority to bind that organization. In that case, "Contractor" and "you" include both you and the organization. If you lack that authority, you may not accept these Terms or use the Platform for that organization.'],
  ['p', 'The Contractor Privacy Notice is incorporated into these Terms by reference and explains how Jalla collects, uses, shares, stores, and protects personal information. Additional terms may apply to specific paid features, payment services, verification services, project assignments, referrals, or partner programs. If an additional written agreement conflicts with these Terms, that agreement controls only for its stated subject matter.'],

  ['h2', '2. Eligibility and authority'],
  ['p', 'You may use a Contractor Account only if you are at least eighteen years old, legally capable of entering into a contract, and permitted to provide the services you describe in every jurisdiction where you operate. You may not use the Platform if you are suspended from Groundwork, prohibited by applicable law, or subject to sanctions or restrictions that make the relationship unlawful.'],
  ['p', 'You are responsible for confirming that your use of Groundwork and your professional activities comply with all licensing, registration, tax, employment, construction, safety, data-protection, and other laws applicable to you.'],

  ['h2', '3. Contractor Account and onboarding information'],
  ['p', 'To create or maintain a Contractor Account, you may be required to provide your legal name, business name, contact information, date of birth, specialty, qualifications, license or registration status and numbers, payment and banking information, emergency contact, identity-verification information, tax information, and other information reasonably required for Platform operation, compliance, security, or payments.'],
  ['p', 'You represent and warrant that all information you provide is accurate, current, complete, and not misleading. You must promptly update information that changes. Jalla may request supporting documents or conduct screening or verification, but Jalla is not required to verify every statement, credential, license, person, business, or project.'],
  ['p', 'You must provide only payment instructions for an account you are authorized to use. You are responsible for losses, delays, rejected transfers, or misdirected funds caused by inaccurate or outdated information supplied by you, except to the extent caused by Jalla’s failure to follow correctly submitted instructions.'],
  ['p', 'If you provide emergency-contact information, you confirm that you have informed the contact and are authorized to provide the information for emergency, safety, security, or account-recovery purposes.'],

  ['h2', '4. Account security'],
  ['p', 'Your Contractor Account is personal to you or your authorized organization. You must maintain the confidentiality of login credentials, use reasonable security measures, and restrict access to authorized personnel. You may not share credentials, permit unauthorized use, or attempt to conceal who is using the account.'],
  ['p', 'You must promptly notify contact@tryjalla.com if you suspect unauthorized access, credential compromise, payment fraud, loss of a device containing Platform or project information, or another security incident. You remain responsible for activity conducted through your account until Jalla has had a reasonable opportunity to secure it.'],

  ['h2', '5. Contractor access is not Partner status'],
  ['p', 'Creating a Contractor Account gives you standard access to the Platform. It does not make you a Jalla employee, agent, representative, joint venturer, Founding Partner, Certified Partner, approved contractor, verified professional, or member of Jalla’s contractor directory.'],
  ['p', 'Partner or directory status requires a separate application, Jalla’s review and acceptance, and any additional terms Jalla specifies. Submission of a partner application does not guarantee acceptance. Jalla may establish, modify, suspend, or withdraw partner tiers, eligibility criteria, incentives, directory placement, and benefits, subject to any separate binding agreement.'],
  ['p', 'Standard Contractor access does not entitle you to client referrals, project assignments, compensation, commissions, directory placement, public endorsement, geographic exclusivity, or preferential treatment. Any such right must be stated in a separate written agreement issued or accepted by Jalla.'],

  ['h2', '6. Nature of the Platform'],
  ['p', 'Groundwork is a technology platform that helps authorized users organize and communicate about construction projects, including project details, milestones, documents, evidence, updates, participants, payment-related information, and records. Unless Jalla expressly agrees otherwise in a separate written agreement, Jalla is not the architect, engineer, contractor, project manager, quantity surveyor, employer, site-safety officer, insurer, escrow agent, fiduciary, or guarantor for a project.'],
  ['p', 'Platform records, reminders, status labels, dashboards, communications, or automated outputs do not constitute professional, engineering, architectural, legal, financial, tax, insurance, or safety advice. A project’s presence on Groundwork does not mean Jalla has approved the design, quality, price, progress, legality, safety, funding, contractor, or outcome.'],
  ['p', 'Independent verification, inspection, payment, bidding, financing, or other services may be offered under separate terms. No Platform feature replaces the professional judgment, supervision, inspections, approvals, permits, or duties required for a construction project.'],

  ['h2', '7. Professional independence and responsibility'],
  ['p', 'You remain solely responsible for the professional services you provide, the people you engage, the advice you give, the work you perform or supervise, and your compliance with the scope agreed with each client. You control your methods and professional decisions and remain responsible for permits, licenses, insurance, taxes, site safety, labor, subcontractors, equipment, materials, and legal duties applicable to your work.'],
  ['p', 'Nothing in these Terms creates employment, agency, partnership, fiduciary, franchise, joint venture, or exclusive dealing between you and Jalla. You may provide services to other clients and use other tools, subject to your confidentiality, security, and lawful-use obligations under these Terms.'],

  ['h2', '8. Client relationships and project authority'],
  ['p', 'You may create, join, or manage a project on Groundwork only when you are authorized by the client, project owner, or another person with lawful authority. Before uploading client or project information, inviting participants, recording communications, or initiating payment-related activity, you must obtain all notices, permissions, and consents required by law and by your agreement with the client.'],
  ['p', 'You may not misrepresent a client’s instructions, project status, budget, progress, approvals, payment authorization, or consent. You may not use Groundwork to circumvent a client, another professional, or a contract, or to obtain information or funds to which you are not entitled.'],
  ['p', 'Your underlying agreement with a client remains between you and the client. Jalla is not a party to that agreement merely because the project uses Groundwork. You are responsible for resolving scope, price, performance, change-order, payment, warranty, defect, and professional-liability issues arising from your services, except where a separate written Jalla agreement expressly states otherwise.'],

  ['h2', '9. Project records and communications'],
  ['p', 'You must use reasonable care to keep project information you enter accurate, timely, complete, and appropriately supported. You must not fabricate, alter, backdate, conceal, or selectively present photos, videos, receipts, reports, milestones, site notes, measurements, approvals, or other evidence in a misleading manner.'],
  ['p', 'Groundwork may preserve account, project, communication, acceptance, and transaction records for operational, evidentiary, security, compliance, and dispute-resolution purposes. Platform timestamps, logs, and audit trails may be used to establish actions taken through an account, subject to applicable law.'],
  ['p', 'You are responsible for maintaining any independent copies of project records that your professional obligations or applicable law require you to retain. Groundwork is not your sole statutory, regulatory, or professional archive unless Jalla expressly agrees otherwise.'],

  ['h2', '10. Payments and payment information'],
  ['p', 'Groundwork may allow users to record, request, approve, schedule, route, or receive project-related payments through Jalla or third-party payment providers. Availability and functionality may vary by country, currency, provider, project, and regulatory requirements. A displayed balance, status, estimate, or payment instruction is not a bank deposit, escrow balance, guarantee, or confirmation of final settlement unless expressly stated.'],
  ['p', 'You authorize Jalla and its payment providers to use payment and banking information to verify identity, establish payout capability, prevent fraud, comply with law, process authorized transfers, reverse erroneous transactions where permitted, and maintain required records. Payment providers may impose separate terms and conduct additional verification.'],
  ['p', 'You are responsible for your pricing, invoices, taxes, withholding, reporting, refunds, and contractual obligations to clients and personnel. Jalla does not guarantee that a client will pay you or that a payment will be available by a particular date. Jalla may delay, reject, suspend, or report payment activity where reasonably necessary to address fraud, sanctions, legal requirements, disputes, security, provider restrictions, or inaccurate information.'],

  ['h2', '11. Fees and paid features'],
  ['p', 'Jalla may provide some Platform features without charge and may offer other features, services, credits, verification requests, bidding access, payment services, or subscriptions for a fee. Applicable prices and transaction terms will be disclosed before you purchase or use a paid feature.'],
  ['p', 'Unless a separate written agreement states otherwise, free or promotional access does not create a permanent right to free access. Jalla may introduce or change fees prospectively upon reasonable notice. Changes will not retroactively alter amounts already paid or binding project-specific terms already accepted.'],
  ['p', 'Partner incentives, referral payments, revenue shares, or professional fees are governed only by the applicable Partner Agreement, Project Order, referral terms, or other written commercial agreement. These Terms alone do not create any right to compensation from Jalla.'],

  ['h2', '12. Confidentiality'],
  ['p', '"Confidential Information" means nonpublic information disclosed through or in connection with Groundwork that a reasonable person would understand to be confidential, including client identities and contact details, project designs, budgets, pricing, contracts, payment information, site records, business plans, product information, security information, and trade secrets. Confidential Information does not include information that you can demonstrate was lawfully known without restriction, independently developed without use of the information, lawfully received from an unrestricted third party, or publicly available without breach.'],
  ['p', 'You must use confidential information only for authorized platform and project purposes; protect it with at least reasonable care; limit access to personnel who need it and are bound by appropriate duties; and not disclose it except with authorization or as required by law. If disclosure is legally required, you must, where lawful, provide prompt notice and reasonable assistance so protective measures may be sought.'],
  ['p', 'You must promptly return, delete, or stop using Confidential Information when your authorization ends, subject to lawful retention duties and routine secure backups. Confidentiality duties continue for five years after disclosure, and for trade secrets as long as they remain protected as trade secrets. These duties do not restrict lawful reporting to regulators or authorities.'],

  ['h2', '13. Privacy, data protection, and security'],
  ['p', 'Jalla processes personal information as described in the Contractor Privacy Notice. You must comply with applicable privacy and data-protection law when collecting, using, sharing, or uploading personal information through Groundwork. You must provide required notices and have a valid legal basis or authorization for client, employee, subcontractor, emergency-contact, and other third-party information you provide.'],
  ['p', 'Unless a separate data-processing agreement states otherwise, each party acts as an independent controller or business for personal information it determines how and why to process. You may access personal information through Groundwork only for authorized professional and project purposes and may not sell it, use it for unrelated marketing, combine it with improperly obtained data, or disclose it to unauthorized persons.'],
  ['p', 'You must use reasonable administrative, physical, and technical safeguards. You must notify contact@tryjalla.com without undue delay, and no later than twenty-four hours after discovery, of suspected unauthorized access, loss, misuse, disclosure, alteration, or destruction of Platform credentials or personal or project information. You must preserve relevant evidence and reasonably cooperate with investigation, containment, notice, and remediation.'],

  ['h2', '14. Contractor Content'],
  ['p', '"Contractor Content" means information, documents, images, videos, designs, reports, messages, profiles, and other materials you or your authorized users submit to Groundwork. As between you and Jalla, you retain ownership of your Contractor Content, subject to the rights of clients and other parties.'],
  ['p', 'You grant Jalla a worldwide, nonexclusive, royalty-free license to host, copy, transmit, format, display, secure, back up, analyze, and otherwise process Contractor Content only as reasonably necessary to operate, support, secure, improve, and provide the Platform; comply with law; enforce agreements; and provide authorized services. This license continues only for as long as reasonably necessary for those purposes and lawful retention.'],
  ['p', 'You represent that you have all rights and permissions needed to submit Contractor Content and grant this license. You may not submit content that infringes rights, violates law, breaches confidentiality, contains malicious code, or is materially false, deceptive, abusive, discriminatory, or unsafe.'],
  ['p', 'Jalla will not use identifiable project or client content in public marketing without appropriate authorization. Any testimonial, case study, public directory profile, or promotional use requiring additional permission will be subject to separate consent or terms.'],

  ['h2', '15. Jalla intellectual property'],
  ['p', 'Jalla and its licensors own the Platform, software, designs, workflows, documentation, trademarks, logos, data models, aggregated insights, and all related intellectual-property rights. Subject to these Terms, Jalla grants you a limited, revocable, nonexclusive, nontransferable right to use the Platform for lawful internal professional and project purposes.'],
  ['p', 'You may not copy, sell, sublicense, rent, reverse engineer, scrape, frame, mirror, bypass, modify, distribute, or create derivative works from the Platform except where applicable law prohibits that restriction. You may not use Jalla names, logos, badges, certification marks, partner labels, or marketing materials without written authorization.'],
  ['p', 'If you voluntarily provide suggestions or feedback, you grant Jalla a perpetual, irrevocable, worldwide, royalty-free right to use it without restriction or compensation, provided Jalla does not publicly identify you as the source without permission.'],

  ['h2', '16. Acceptable use'],
  ['p', 'You must not use Groundwork to:'],
  ['clause', 'violate law, licensing requirements, professional duties, sanctions, or another person’s rights;'],
  ['clause', 'commit or facilitate fraud, bribery, corruption, money laundering, theft, diversion of project funds, or deceptive conduct;'],
  ['clause', 'impersonate another person, misstate credentials, create false accounts, or manipulate project records;'],
  ['clause', 'upload malware, probe security, interfere with service, evade access controls, or obtain unauthorized data;'],
  ['clause', 'harass, threaten, discriminate against, exploit, or endanger clients, workers, professionals, or other users;'],
  ['clause', 'send spam, harvest contact details, or use Platform data for unrelated solicitation;'],
  ['clause', 'permit unlicensed or unauthorized persons to perform regulated work under your identity; or'],
  ['clause', 'use the Platform in a way that could materially harm Jalla, a project, a client, another user, or the integrity of the Groundwork network.'],

  ['h2', '17. Third-party services'],
  ['p', 'Groundwork may integrate or link to payment processors, identity-verification providers, messaging services, maps, cloud storage, analytics, banks, or other third parties. Their services are governed by their own terms and privacy practices. Jalla is not responsible for third-party services outside Jalla’s reasonable control, but this does not limit responsibility Jalla cannot lawfully exclude.'],

  ['h2', '18. Monitoring, verification, and cooperation'],
  ['p', 'Jalla may review activity, request information, investigate complaints, verify credentials, remove content, restrict features, or cooperate with clients, payment providers, insurers, regulators, law enforcement, or professional bodies where reasonably necessary for safety, integrity, fraud prevention, legal compliance, or enforcement. Jalla is not obligated to monitor every project, communication, or professional.'],
  ['p', 'You must reasonably cooperate with legitimate investigations concerning your account or activity. Jalla may disclose information where authorized by the Privacy Notice, required by law, necessary to protect rights or safety, or reasonably needed to address fraud or a material breach.'],

  ['h2', '19. Suspension and termination'],
  ['p', 'You may stop using Groundwork at any time and may request account closure, subject to project, payment, record-retention, dispute, and legal obligations. Jalla may suspend or restrict access immediately where reasonably necessary to address security, fraud, unlawful conduct, sanctions, risk to a project or person, nonpayment, inaccurate credentials, misuse, or material breach.'],
  ['p', 'Jalla may terminate standard access for convenience on reasonable notice. Where practical, Jalla will allow export or retrieval of authorized project information before termination. Jalla may retain or provide records where required by law, necessary for disputes or payments, or permitted under the Privacy Notice.'],
  ['p', 'Sections concerning professional responsibility, payments, confidentiality, privacy, intellectual property, disclaimers, liability, indemnification, disputes, records, and general terms survive termination to the extent their nature requires.'],

  ['h2', '20. Disclaimers'],
  ['p', 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE." JALLA DISCLAIMS IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND WARRANTIES ARISING FROM COURSE OF DEALING OR USAGE. JALLA DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR SUITABLE FOR EVERY PROJECT OR JURISDICTION.'],
  ['p', 'JALLA DOES NOT GUARANTEE ANY CLIENT, PROJECT, REFERRAL, PAYMENT, REVENUE, DIRECTORY PLACEMENT, PARTNER STATUS, CERTIFICATION, PROFESSIONAL OUTCOME, CONSTRUCTION QUALITY, PROJECT COMPLETION, COST, SCHEDULE, OR DISPUTE RESULT. NOTHING IN THIS SECTION EXCLUDES A WARRANTY OR RIGHT THAT CANNOT LAWFULLY BE EXCLUDED.'],

  ['h2', '21. Limitation of liability'],
  ['p', 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE TO THE OTHER FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES, OR FOR LOST PROFITS, REVENUE, BUSINESS, DATA, GOODWILL, OR OPPORTUNITIES, ARISING FROM THESE TERMS OR PLATFORM USE, EVEN IF ADVISED OF THE POSSIBILITY.'],
  ['p', 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, JALLA’S TOTAL AGGREGATE LIABILITY ARISING FROM OR RELATING TO THESE TERMS OR THE PLATFORM WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID DIRECTLY TO JALLA FOR PLATFORM ACCESS DURING THE TWELVE MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY OR (B) US $250.'],
  ['p', 'The exclusions and cap do not apply to liability that cannot lawfully be limited, including liability for fraud or willful misconduct where applicable. Separate services or Project Orders may establish different limits for their subject matter.'],

  ['h2', '22. Indemnification'],
  ['p', 'To the extent permitted by law, you will defend, indemnify, and hold harmless Jalla and its officers, directors, employees, and agents from third-party claims, losses, damages, judgments, penalties, and reasonable legal fees arising from: (a) your professional services or construction activities; (b) your breach of these Terms or applicable law; (c) your Contractor Content or lack of authority to provide it; (d) your infringement, fraud, negligence, willful misconduct, or violation of another person’s rights; or (e) a dispute between you and a client, worker, subcontractor, supplier, or other professional, except to the extent caused by Jalla’s own breach, negligence, fraud, or willful misconduct.'],
  ['p', 'Jalla will provide reasonable notice of an indemnified claim and allow you to control the defense, provided you may not settle in a way that admits fault by Jalla, imposes nonmonetary obligations on Jalla, or fails to release Jalla without Jalla’s written consent.'],

  ['h2', '23. Changes to these Terms'],
  ['p', 'Jalla may update these Terms to reflect changes in the Platform, law, risk, or business operations. Jalla will provide reasonable notice of material changes. If a change materially affects your duties, fees, dispute rights, or liability, Jalla may require renewed affirmative acceptance. Changes apply prospectively from the stated effective date. If you do not agree, you must stop using the affected services and may close your account, subject to existing obligations.'],

  ['h2', '24. Electronic records, acceptance, and notices'],
  ['p', 'You agree to conduct this transaction electronically. By selecting the acceptance checkbox and typing your full legal name, you intend to sign these Terms electronically and agree that your electronic acceptance has the same legal effect as a handwritten signature. Jalla may record your name, account identifier, document version, date and time, IP address, device or browser information, and acceptance event as evidence of agreement.'],
  ['p', 'You must be able to access the Terms and Privacy Notice electronically and download, print, or retain a copy. You may request a copy by contacting Jalla. Notices may be provided through the Platform or to the email or contact information associated with your account. You must keep that information current.'],
  ['p', 'You may withdraw consent to future electronic records by closing your account and contacting Jalla, but withdrawal does not affect records or agreements already validly provided or accepted and may make continued Platform use unavailable.'],

  ['h2', '25. Governing law and disputes'],
  ['p', 'These Terms are governed by the laws of the State of Maryland, United States, without regard to conflict-of-law rules, except where mandatory local law applies. Before filing a claim, the parties will attempt in good faith for thirty days to resolve it through written notice and direct discussion.'],
  ['p', 'Subject to mandatory law, the state and federal courts located in Prince George’s County, Maryland, or the federal judicial district serving that county, will have exclusive jurisdiction over disputes arising from these Terms or the Platform. Either party may seek urgent injunctive or protective relief in any court with jurisdiction to protect confidential information, intellectual property, security, funds, or persons.'],

  ['h2', '26. Compliance, sanctions, and anti-corruption'],
  ['p', 'You must comply with applicable anti-bribery, anti-corruption, anti-money-laundering, sanctions, export-control, and financial-crime laws. You may not offer, promise, request, accept, or conceal an improper payment or benefit in connection with Jalla, Groundwork, a client, a project, or a public official. You must provide reasonable compliance information when lawfully requested.'],

  ['h2', '27. General terms'],
  ['p', 'These Terms, the Contractor Privacy Notice, and any applicable additional written terms constitute the entire agreement concerning standard Contractor access to Groundwork and supersede prior discussions on that subject. They do not replace a separate Partner Agreement, Project Order, client contract, or paid-service terms.'],
  ['p', 'You may not assign these Terms without Jalla’s written consent. Jalla may assign them in connection with a merger, financing, reorganization, sale of assets, or transfer of the Platform, provided the assignee assumes the relevant obligations. If a provision is unenforceable, it will be enforced to the maximum lawful extent and the remainder will continue. Failure to enforce a provision is not a waiver. Headings are for convenience only. "Including" means "including without limitation."'],
  ['p', 'The English version controls unless Jalla expressly states that another language version is authoritative. A translated version may be provided for convenience. Nothing in these Terms limits nonwaivable rights under applicable law.'],

  ['h2', '28. Contact information'],
  ['p', 'Questions, notices, privacy requests, or legal correspondence may be sent to Jalla Technologies Inc., 120 Waterfront St, Suite 420 #2075, National Harbor, Maryland 20745, United States, email: contact@tryjalla.com.'],
];
