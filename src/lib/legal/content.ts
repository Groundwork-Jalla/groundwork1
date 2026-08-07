import type { Lang } from '@/lib/i18n/types';

// =========================================================
// Legal documents — privacy policy and terms of service.
//
// Kept OUT of en.ts / fr.ts deliberately. These are long prose documents with
// no interpolation, they change on a legal cadence rather than a product one,
// and they need to be handed to a lawyer as a single readable file. Folding
// hundreds of lines of legalese into the UI dictionaries would bury the strings
// that actually get translated day to day.
//
// ⚠️  DRAFT — NOT LEGAL ADVICE.
// This was written to describe what the product genuinely does (the processors
// listed are the ones actually wired up: Supabase, Resend, Stripe, Switchr,
// GoHighLevel, Google, Vercel, Sentry). It is a starting point for review by a
// qualified lawyer in your operating jurisdictions — not a substitute for one.
// Google and Stripe both require these links before you can go live.
// =========================================================

export interface LegalSection {
  heading: string;
  /** Paragraphs. A line starting with "- " renders as a bullet. */
  body: string[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

/** Displayed as "Last updated". Bump when the text materially changes. */
const UPDATED_EN = '8 August 2026';
const UPDATED_FR = '8 août 2026';

const CONTACT = 'contact@tryjalla.com';

// ── Privacy ───────────────────────────────────────────────

const PRIVACY_EN: LegalDoc = {
  title: 'Privacy Policy',
  updated: UPDATED_EN,
  intro:
    'Groundwork is a construction project management platform operated by Jalla. This policy explains what information we collect, why we collect it, who we share it with, and the choices you have. It applies to the Groundwork web application and the public pages at tryjalla.com.',
  sections: [
    {
      heading: 'Information you give us',
      body: [
        'When you create an account we collect your name, email address, and password. If you sign in with Google we receive your name, email address, and profile picture from Google — never your Google password.',
        'When you create a project we collect the details you enter about it: country, city, building type, size, number of floors and rooms, finish level, target start date, and your budget.',
        'As your build progresses we store what you and your contractor upload: photographs and documents used as stage evidence, contracts, permits, receipts, invoices, and reports.',
        'If you apply to our contractor network we collect your professional details: business name, phone number, trade, years of experience, service areas, project history, client references, and any certificates or portfolio files you upload.',
        'If you message through the platform we store those messages so the other participants in your project can read them.',
      ],
    },
    {
      heading: 'Information we collect automatically',
      body: [
        'We collect basic usage and device information — pages visited, approximate location derived from your IP address, browser and device type — to operate the service and understand how it is used.',
        'We record technical error reports when something goes wrong, so we can fix it.',
        'We store your language and theme preferences in your browser so the app remembers them.',
      ],
    },
    {
      heading: 'How we use your information',
      body: [
        '- To provide the service: create your account, run your project, track stages, and calculate budgets and payment milestones.',
        '- To communicate with you: confirmation and password emails, stage approval and rework notifications, and replies to your enquiries.',
        '- To verify work, where your plan includes verification, by reviewing the evidence submitted against the stage specification.',
        '- To process payments and, where applicable, contractor payouts.',
        '- To review contractor applications, including contacting the references you provide.',
        '- To keep the service secure, prevent abuse, and meet our legal obligations.',
        'We do not sell your personal information, and we do not use your project photographs or documents for advertising.',
      ],
    },
    {
      heading: 'Who we share it with',
      body: [
        'We share information with service providers who process it on our behalf, only as needed to run Groundwork:',
        '- Supabase — database, file storage, and authentication.',
        '- Resend — transactional email delivery.',
        '- Stripe — subscription billing and payment processing.',
        '- Switchr — contractor payouts in local currency.',
        '- GoHighLevel — customer relationship management for contractor applications and waitlist enquiries.',
        '- Google — sign-in, if you choose to use it.',
        '- Vercel — application hosting.',
        '- Sentry — error monitoring.',
        'We also share information within your own project: your contractor can see the project details and evidence for the stages they work on, and you can see what they upload. Jalla staff can access project data where your plan includes verification or management, or where you ask us for support.',
        'We may disclose information if required by law, or to protect the rights and safety of our users.',
      ],
    },
    {
      heading: 'International transfers',
      body: [
        'Groundwork serves clients in the diaspora building in Africa, so information routinely moves between countries. Our providers store and process data on servers that may be located outside your country of residence, including in the United States and the European Union. We rely on our providers’ contractual safeguards for these transfers.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'We keep your account and project data for as long as your account is active. If you close your account, we retain your project data for 90 days so it can be restored or exported, after which it is deleted or anonymised.',
        'Contractor applications are retained while under review and for a reasonable period afterwards so we can reconsider applicants as the network expands.',
        'We keep records we are required to keep for tax, accounting, or legal reasons for as long as the law requires.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'You can access and correct most of your information directly in the app, under Settings.',
        `You may ask us to export your data, delete your account, correct inaccurate information, or restrict how we use it. Contact ${CONTACT} and we will respond within a reasonable time.`,
        'Depending on where you live you may have additional rights under local data protection law, including the right to complain to a supervisory authority.',
      ],
    },
    {
      heading: 'Security',
      body: [
        'Data is encrypted in transit. Uploaded documents are stored in private buckets that are not publicly readable, and access is restricted to the project’s participants and authorised Jalla staff.',
        'No system is perfectly secure. Use a strong, unique password, and tell us promptly if you believe your account has been accessed without your permission.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'Groundwork is not intended for anyone under 18, and we do not knowingly collect information from children.',
      ],
    },
    {
      heading: 'Changes to this policy',
      body: [
        'We may update this policy as the product changes. When we make material changes we will update the date at the top and, where appropriate, notify you in the app or by email.',
      ],
    },
    {
      heading: 'Contact us',
      body: [
        `Questions about this policy or your data: ${CONTACT}`,
      ],
    },
  ],
};

const PRIVACY_FR: LegalDoc = {
  title: 'Politique de confidentialité',
  updated: UPDATED_FR,
  intro:
    "Groundwork est une plateforme de gestion de projets de construction exploitée par Jalla. Cette politique explique quelles informations nous recueillons, pourquoi, avec qui nous les partageons et quels sont vos choix. Elle s'applique à l'application web Groundwork et aux pages publiques de tryjalla.com.",
  sections: [
    {
      heading: 'Informations que vous nous fournissez',
      body: [
        "Lors de la création d'un compte, nous recueillons votre nom, votre adresse e-mail et votre mot de passe. Si vous vous connectez avec Google, nous recevons de Google votre nom, votre adresse e-mail et votre photo de profil — jamais votre mot de passe Google.",
        "Lorsque vous créez un projet, nous recueillons les détails que vous saisissez : pays, ville, type de bâtiment, superficie, nombre d'étages et de pièces, niveau de finition, date de début prévue et budget.",
        "Au fil du chantier, nous conservons ce que vous et votre entrepreneur téléversez : photographies et documents servant de preuves d'étape, contrats, permis, reçus, factures et rapports.",
        "Si vous postulez à notre réseau d'entrepreneurs, nous recueillons vos informations professionnelles : nom de l'entreprise, téléphone, métier, années d'expérience, zones d'intervention, historique de projets, références clients, ainsi que les certificats ou pièces de portfolio que vous téléversez.",
        "Si vous échangez des messages via la plateforme, nous les conservons afin que les autres participants à votre projet puissent les lire.",
      ],
    },
    {
      heading: 'Informations collectées automatiquement',
      body: [
        "Nous recueillons des informations d'usage et d'appareil — pages consultées, localisation approximative déduite de votre adresse IP, type de navigateur et d'appareil — pour exploiter le service et comprendre son utilisation.",
        "Nous enregistrons des rapports d'erreur techniques lorsqu'un problème survient, afin de le corriger.",
        "Nous conservons vos préférences de langue et de thème dans votre navigateur pour que l'application s'en souvienne.",
      ],
    },
    {
      heading: 'Utilisation de vos informations',
      body: [
        '- Fournir le service : créer votre compte, gérer votre projet, suivre les étapes, calculer les budgets et les jalons de paiement.',
        "- Communiquer avec vous : e-mails de confirmation et de mot de passe, notifications d'approbation ou de reprise d'étape, réponses à vos demandes.",
        "- Vérifier les travaux, lorsque votre formule inclut la vérification, en examinant les preuves soumises au regard du cahier des charges de l'étape.",
        '- Traiter les paiements et, le cas échéant, les versements aux entrepreneurs.',
        "- Examiner les candidatures d'entrepreneurs, y compris en contactant les références que vous fournissez.",
        '- Assurer la sécurité du service, prévenir les abus et respecter nos obligations légales.',
        "Nous ne vendons pas vos informations personnelles et n'utilisons pas les photographies ou documents de vos chantiers à des fins publicitaires.",
      ],
    },
    {
      heading: 'Avec qui nous les partageons',
      body: [
        "Nous partageons des informations avec des prestataires qui les traitent pour notre compte, uniquement dans la mesure nécessaire au fonctionnement de Groundwork :",
        "- Supabase — base de données, stockage de fichiers et authentification.",
        '- Resend — envoi des e-mails transactionnels.',
        '- Stripe — facturation des abonnements et traitement des paiements.',
        '- Switchr — versements aux entrepreneurs en monnaie locale.',
        "- GoHighLevel — gestion de la relation client pour les candidatures d'entrepreneurs et les demandes de liste d'attente.",
        '- Google — connexion, si vous choisissez de l’utiliser.',
        "- Vercel — hébergement de l'application.",
        '- Sentry — surveillance des erreurs.',
        "Nous partageons également des informations au sein de votre projet : votre entrepreneur voit les détails du projet et les preuves des étapes sur lesquelles il intervient, et vous voyez ce qu'il téléverse. Le personnel de Jalla peut accéder aux données du projet lorsque votre formule inclut la vérification ou la gestion, ou lorsque vous sollicitez notre assistance.",
        "Nous pouvons divulguer des informations si la loi l'exige, ou pour protéger les droits et la sécurité de nos utilisateurs.",
      ],
    },
    {
      heading: 'Transferts internationaux',
      body: [
        "Groundwork s'adresse à des clients de la diaspora qui construisent en Afrique : les informations circulent donc régulièrement entre pays. Nos prestataires stockent et traitent les données sur des serveurs pouvant se situer hors de votre pays de résidence, notamment aux États-Unis et dans l'Union européenne. Nous nous appuyons sur les garanties contractuelles de ces prestataires pour ces transferts.",
      ],
    },
    {
      heading: 'Durée de conservation',
      body: [
        "Nous conservons vos données de compte et de projet tant que votre compte est actif. Si vous fermez votre compte, nous conservons les données du projet pendant 90 jours afin de permettre leur restauration ou leur export, puis elles sont supprimées ou anonymisées.",
        "Les candidatures d'entrepreneurs sont conservées pendant leur examen et pour une durée raisonnable ensuite, afin de pouvoir réexaminer les candidats à mesure que le réseau s'élargit.",
        "Nous conservons les documents que la loi nous impose de conserver pour des raisons fiscales, comptables ou légales, aussi longtemps que requis.",
      ],
    },
    {
      heading: 'Vos droits',
      body: [
        "Vous pouvez consulter et corriger la plupart de vos informations directement dans l'application, dans Paramètres.",
        `Vous pouvez nous demander d'exporter vos données, de supprimer votre compte, de corriger des informations inexactes ou de limiter leur utilisation. Écrivez à ${CONTACT} et nous répondrons dans un délai raisonnable.`,
        "Selon votre lieu de résidence, vous pouvez disposer de droits supplémentaires au titre de la législation locale sur la protection des données, y compris celui de saisir une autorité de contrôle.",
      ],
    },
    {
      heading: 'Sécurité',
      body: [
        "Les données sont chiffrées en transit. Les documents téléversés sont stockés dans des espaces privés non accessibles publiquement, et l'accès est réservé aux participants du projet et au personnel autorisé de Jalla.",
        "Aucun système n'est parfaitement sûr. Utilisez un mot de passe fort et unique, et prévenez-nous rapidement si vous pensez que votre compte a été consulté sans votre autorisation.",
      ],
    },
    {
      heading: 'Mineurs',
      body: [
        "Groundwork ne s'adresse pas aux personnes de moins de 18 ans et nous ne recueillons pas sciemment d'informations auprès d'enfants.",
      ],
    },
    {
      heading: 'Modifications de cette politique',
      body: [
        "Nous pouvons mettre à jour cette politique à mesure que le produit évolue. En cas de modification substantielle, nous mettrons à jour la date en haut de page et, le cas échéant, vous en informerons dans l'application ou par e-mail.",
      ],
    },
    {
      heading: 'Nous contacter',
      body: [
        `Questions sur cette politique ou vos données : ${CONTACT}`,
      ],
    },
  ],
};

// ── Terms ─────────────────────────────────────────────────

const TERMS_EN: LegalDoc = {
  title: 'Terms of Service',
  updated: UPDATED_EN,
  intro:
    'These terms govern your use of Groundwork, a construction project management platform operated by Jalla. By creating an account or using the service you agree to them. Please read the sections on verification and on your relationship with contractors carefully — they describe important limits on what Groundwork does.',
  sections: [
    {
      heading: 'What Groundwork is',
      body: [
        'Groundwork helps you plan, track, and document a construction project. It breaks a build into stages, records evidence for each stage, estimates budgets, and tracks payment milestones.',
        'Groundwork is a management and record-keeping tool. It is not a construction company, an architect, an engineer, a surveyor, a lawyer, or a bank.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'You must be at least 18 and provide accurate information. You are responsible for your password and for everything done through your account.',
        'Tell us promptly if you believe your account has been used without your permission.',
      ],
    },
    {
      heading: 'Plans and fees',
      body: [
        'Groundwork offers different plans with different features and limits. Paid subscriptions renew automatically until cancelled, and cancelling takes effect at the end of the billing period you have already paid for.',
        'Where we process a stage payment, a platform fee may apply. The fee is shown before you confirm the payment.',
        'Budget figures produced by Groundwork are estimates based on the details you provide and regional cost data. They are not quotations, valuations, or guarantees of what your build will cost.',
      ],
    },
    {
      heading: 'Verification — what it does and does not mean',
      body: [
        'On plans that include verification, Jalla reviews the evidence submitted for a stage — photographs, documents, and certifications — and confirms whether it appears consistent with the stage specification before you release payment.',
        'Verification is a review of submitted evidence. It is not a physical structural inspection, a certification of workmanship or safety, an engineering sign-off, or a warranty of any kind. It does not replace the inspections, permits, and professional certifications required by law where you are building.',
        'You remain responsible for satisfying yourself as to the quality and legality of the work, and for obtaining any independent professional advice you need.',
      ],
    },
    {
      heading: 'Contractors and other professionals',
      body: [
        'Contractors and other professionals who use Groundwork are independent. They are not employed by, or agents of, Jalla.',
        'Any contract for construction work is between you and them directly. Jalla is not a party to it and is not responsible for their work, their conduct, delays, defects, or any dispute between you.',
        'Inclusion in our network means an applicant passed our review process. It is not a guarantee of their performance on your project.',
      ],
    },
    {
      heading: 'Your content',
      body: [
        'You keep ownership of everything you upload — photographs, documents, and messages. You grant us the licence we need to store it, display it to the other participants in your project, and process it to run the service.',
        'You must have the right to upload what you upload, and it must not be unlawful or infringe anyone else’s rights.',
      ],
    },
    {
      heading: 'Acceptable use',
      body: [
        '- Do not upload false or misleading evidence, or misrepresent the state of a build.',
        '- Do not upload unlawful, harmful, or infringing content.',
        '- Do not attempt to access another user’s project or account, or to disrupt or probe the service.',
        '- Do not use Groundwork to arrange payments outside the platform for projects Jalla is managing, where your agreement with us says otherwise.',
        'We may suspend or close accounts that breach these rules.',
      ],
    },
    {
      heading: 'Availability',
      body: [
        'We work to keep Groundwork available, but we do not promise uninterrupted service. Features may change, and we may suspend the service for maintenance or for reasons outside our control.',
      ],
    },
    {
      heading: 'Limitation of liability',
      body: [
        'To the fullest extent permitted by law, Jalla is not liable for construction defects, delays, cost overruns, disputes with contractors, or losses arising from decisions you make using information in Groundwork.',
        'Nothing in these terms limits liability that cannot be limited by law, including liability for fraud, or for death or personal injury caused by negligence.',
      ],
    },
    {
      heading: 'Ending your use',
      body: [
        'You may stop using Groundwork and close your account at any time. We may suspend or close an account that breaches these terms, or where we are required to by law.',
        'When an account closes, our data retention practices in the Privacy Policy apply.',
      ],
    },
    {
      heading: 'Changes to these terms',
      body: [
        'We may update these terms as the product and the law change. When we make material changes we will update the date at the top and, where appropriate, notify you in the app or by email. Continuing to use Groundwork after a change means you accept the updated terms.',
      ],
    },
    {
      heading: 'Contact us',
      body: [
        `Questions about these terms: ${CONTACT}`,
      ],
    },
  ],
};

const TERMS_FR: LegalDoc = {
  title: "Conditions d'utilisation",
  updated: UPDATED_FR,
  intro:
    "Ces conditions régissent votre utilisation de Groundwork, une plateforme de gestion de projets de construction exploitée par Jalla. En créant un compte ou en utilisant le service, vous les acceptez. Lisez attentivement les sections sur la vérification et sur votre relation avec les entrepreneurs : elles décrivent des limites importantes de ce que fait Groundwork.",
  sections: [
    {
      heading: "Ce qu'est Groundwork",
      body: [
        "Groundwork vous aide à planifier, suivre et documenter un projet de construction. La plateforme découpe le chantier en étapes, enregistre les preuves de chaque étape, estime les budgets et suit les jalons de paiement.",
        "Groundwork est un outil de gestion et de traçabilité. Ce n'est ni une entreprise de construction, ni un architecte, ni un ingénieur, ni un géomètre, ni un avocat, ni une banque.",
      ],
    },
    {
      heading: 'Votre compte',
      body: [
        "Vous devez avoir au moins 18 ans et fournir des informations exactes. Vous êtes responsable de votre mot de passe et de tout ce qui est fait via votre compte.",
        "Prévenez-nous rapidement si vous pensez que votre compte a été utilisé sans votre autorisation.",
      ],
    },
    {
      heading: 'Formules et frais',
      body: [
        "Groundwork propose différentes formules aux fonctionnalités et limites variables. Les abonnements payants se renouvellent automatiquement jusqu'à résiliation, et la résiliation prend effet à la fin de la période déjà réglée.",
        "Lorsque nous traitons le paiement d'une étape, des frais de plateforme peuvent s'appliquer. Ces frais sont affichés avant que vous ne confirmiez le paiement.",
        "Les montants budgétaires produits par Groundwork sont des estimations fondées sur les informations que vous fournissez et sur des données de coûts régionales. Ce ne sont ni des devis, ni des évaluations, ni des garanties du coût final de votre chantier.",
      ],
    },
    {
      heading: 'Vérification — ce qu’elle signifie et ne signifie pas',
      body: [
        "Sur les formules incluant la vérification, Jalla examine les preuves soumises pour une étape — photographies, documents, certifications — et confirme si elles paraissent conformes au cahier des charges de l'étape avant que vous ne libériez le paiement.",
        "La vérification est un examen des preuves soumises. Ce n'est pas une inspection structurelle physique, ni une certification de la qualité d'exécution ou de la sécurité, ni une validation d'ingénierie, ni une garantie de quelque nature que ce soit. Elle ne remplace pas les inspections, permis et certifications professionnelles exigés par la loi du lieu de construction.",
        "Il vous appartient de vous assurer de la qualité et de la légalité des travaux et d'obtenir les avis professionnels indépendants dont vous avez besoin.",
      ],
    },
    {
      heading: 'Entrepreneurs et autres professionnels',
      body: [
        "Les entrepreneurs et autres professionnels qui utilisent Groundwork sont indépendants. Ils ne sont ni employés ni mandataires de Jalla.",
        "Tout contrat de travaux est conclu directement entre eux et vous. Jalla n'y est pas partie et n'est pas responsable de leurs travaux, de leur conduite, des retards, des malfaçons ou de tout litige entre vous.",
        "L'appartenance à notre réseau signifie qu'un candidat a passé notre processus d'examen. Ce n'est pas une garantie de sa performance sur votre chantier.",
      ],
    },
    {
      heading: 'Vos contenus',
      body: [
        "Vous conservez la propriété de tout ce que vous téléversez — photographies, documents et messages. Vous nous accordez la licence nécessaire pour les stocker, les afficher aux autres participants de votre projet et les traiter afin d'exploiter le service.",
        "Vous devez disposer des droits sur ce que vous téléversez, et ces contenus ne doivent être ni illicites ni contrefaisants.",
      ],
    },
    {
      heading: 'Usage acceptable',
      body: [
        "- Ne téléversez pas de preuves fausses ou trompeuses et ne dénaturez pas l'état d'un chantier.",
        '- Ne téléversez pas de contenus illicites, nuisibles ou contrefaisants.',
        "- N'essayez pas d'accéder au projet ou au compte d'un autre utilisateur, ni de perturber ou de sonder le service.",
        "- N'utilisez pas Groundwork pour organiser des paiements hors plateforme sur des projets gérés par Jalla, lorsque votre accord avec nous le prévoit autrement.",
        'Nous pouvons suspendre ou fermer les comptes qui enfreignent ces règles.',
      ],
    },
    {
      heading: 'Disponibilité',
      body: [
        "Nous nous efforçons de maintenir Groundwork disponible, mais nous ne garantissons pas un service ininterrompu. Les fonctionnalités peuvent évoluer et nous pouvons suspendre le service pour maintenance ou pour des raisons indépendantes de notre volonté.",
      ],
    },
    {
      heading: 'Limitation de responsabilité',
      body: [
        "Dans toute la mesure permise par la loi, Jalla n'est pas responsable des malfaçons, retards, dépassements de coûts, litiges avec des entrepreneurs, ni des pertes découlant des décisions que vous prenez à partir des informations figurant dans Groundwork.",
        "Rien dans ces conditions ne limite une responsabilité qui ne peut l'être légalement, notamment en cas de fraude, de décès ou de dommage corporel causé par une négligence.",
      ],
    },
    {
      heading: 'Fin de votre utilisation',
      body: [
        "Vous pouvez cesser d'utiliser Groundwork et fermer votre compte à tout moment. Nous pouvons suspendre ou fermer un compte qui enfreint ces conditions, ou lorsque la loi nous y oblige.",
        "À la fermeture d'un compte, les règles de conservation décrites dans la Politique de confidentialité s'appliquent.",
      ],
    },
    {
      heading: 'Modifications de ces conditions',
      body: [
        "Nous pouvons mettre à jour ces conditions à mesure que le produit et la loi évoluent. En cas de modification substantielle, nous mettrons à jour la date en haut de page et, le cas échéant, vous en informerons dans l'application ou par e-mail. Continuer à utiliser Groundwork après une modification vaut acceptation des conditions mises à jour.",
      ],
    },
    {
      heading: 'Nous contacter',
      body: [
        `Questions sur ces conditions : ${CONTACT}`,
      ],
    },
  ],
};

export const PRIVACY: Record<Lang, LegalDoc> = { en: PRIVACY_EN, fr: PRIVACY_FR };
export const TERMS:   Record<Lang, LegalDoc> = { en: TERMS_EN,   fr: TERMS_FR };
