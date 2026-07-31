// =========================================================
// French dictionary.
//
// Typed as `Mirror<EnDict>` — every key in en.ts must exist here with a string
// value, or this file fails to compile. That guarantees we never silently ship
// an untranslated screen.
//
// Terminology decisions (Cameroon / West-Central African construction French):
//   build / project   → chantier (physical build) / projet (the record)
//   stage             → étape
//   substage          → sous-étape
//   contractor        → entrepreneur
//   evidence          → justificatifs (photos/documents proving work)
//   project owner     → maître d'ouvrage
//   boys' quarters    → dépendance (BQ)
// =========================================================

import type { EnDict } from './en';

/** Maps the EN dictionary shape to plain mutable strings. */
type Mirror<T> = {
  [K in keyof T]: T[K] extends string ? string : Mirror<T[K]>;
};

export const fr: Mirror<EnDict> = {
  // ── Générique / partagé ───────────────────────────────────
  common: {
    back:           'Retour',
    backToHome:     "Retour à l'accueil",
    cancel:         'Annuler',
    continue:       'Continuer',
    save:           'Enregistrer',
    saving:         'Enregistrement…',
    saved:          'Enregistré',
    submit:         'Envoyer',
    submitting:     'Envoi…',
    close:          'Fermer',
    open:           'Ouvrir',
    delete:         'Supprimer',
    edit:           'Modifier',
    loading:        'Chargement…',
    search:         'Rechercher',
    viewAll:        'Tout voir',
    learnMore:      'En savoir plus',
    getStarted:     'Commencer',
    getStartedFree: 'Commencer gratuitement',
    createAccount:  'Créer un compte',
    logIn:          'Se connecter',
    logOut:         'Se déconnecter',
    signIn:         'Connexion',
    signUp:         "S'inscrire",
    download:       'Télécharger',
    upload:         'Téléverser',
    retry:          'Réessayer',
    optional:       '(facultatif)',
    required:       'Obligatoire',
    yes:            'Oui',
    no:             'Non',
    or:             'OU',
    of:             'sur',
    complete:       'Terminé',
    completed:      'Terminé',
    inProgress:     'En cours',
    locked:         'Verrouillé',
    pending:        'En attente',
    active:         'Actif',
    archived:       'Archivé',
    onHold:         'En pause',
    somethingWrong: "Une erreur s'est produite. Veuillez actualiser la page.",
    notFound:       'Introuvable',
    allRightsReserved: 'Tous droits réservés.',
  },

  // ── Sélecteur de langue ───────────────────────────────────
  lang: {
    switchTo:   'Passer en {lang}',
    language:   'Langue',
    english:    'English',
    french:     'Français',
  },

  // ── Thème ─────────────────────────────────────────────────
  theme: {
    lightMode:      'Mode clair',
    darkMode:       'Mode sombre',
    switchToLight:  'Passer en mode clair',
    switchToDark:   'Passer en mode sombre',
  },

  // ── Navigation ────────────────────────────────────────────
  nav: {
    dashboard:      'Tableau de bord',
    myProjects:     'Mes projets',
    projects:       'Projets',
    documents:      'Documents',
    resources:      'Ressources',
    contractors:    'Entrepreneurs',
    payments:       'Paiements',
    notifications:  'Notifications',
    settings:       'Paramètres',
    help:           'Aide',
    upgradePlan:    'Changer de forfait',
    community:      'Communauté',
    pricing:        'Tarifs',
    tools:          'Outils',
    freeTools:      'Outils gratuits',
    viewProfile:    'Voir le profil',
    skipToContent:  'Aller au contenu principal',
    groundwork:     'Groundwork',
  },

  // ── Page d'accueil ────────────────────────────────────────
  landing: {
    nav: {
      joinFree:       'Rejoindre gratuitement',
      forContractors: 'Pour les entrepreneurs',
    },
    hero: {
      title:    'La nouvelle façon de bâtir au pays',
      titleAlt: 'Sans perdre le contrôle.',
    },
    whatJallaDoes: {
      eyebrow:      'CE QUE FAIT JALLA',
      videoSoon:    'Vidéo bientôt disponible',
    },
    comparison: {
      without: 'Sans structure',
      with:    'Avec Groundwork',
    },
    risk: {
      budgetDrains:     'Le budget fond en silence',
      noMilestones:     'Aucun jalon clair',
      noVerification:   'Personne ne vérifie les travaux',
      noProof:          'Aucune preuve photo ou vidéo',
      delays:           'Des retards coûteux',
      misaligned:       'Entrepreneur et propriétaire désaccordés',
    },
    carousel: {
      createProject:   'Créez un projet',
      submitEvidence:  "L'entrepreneur soumet les justificatifs",
      jallaVerifies:   'Jalla vérifie les travaux',
      paymentSent:     'Le paiement est débloqué',
    },
    why: {
      moneyProtected:  'Votre argent reste protégé',
      independentCheck:'Chaque étape est vérifiée indépendamment',
      fullVisibility:  "Une visibilité totale, où que vous soyez",
    },
  },

  // ── Tarifs ────────────────────────────────────────────────
  pricing: {
    eyebrow:   'Des tarifs simples et transparents',
    title:     'Bâtissez en toute confiance.',
    titleLine2:'Ne payez que le travail accompli.',
    subtitle:  "Commencez gratuitement. Passez à la vitesse supérieure quand vous voulez que Jalla vérifie chaque étape avant que vous ne débloquiez le moindre franc.",
    mostPopular: 'Le plus populaire',
    faqTitle:  'Questions fréquentes',
    ctaTitle:  'Prêt à suivre votre chantier ?',
    ctaBody:   "Commencez gratuitement — sans carte bancaire. Passez à un forfait supérieur dès que vous avez besoin de l'œil de Jalla sur votre chantier.",
    ctaButton: 'Créer votre compte',
    plans: {
      selfVerify: {
        name:    'Self Verify',
        price:   'Gratuit',
        tagline: 'Pour les propriétaires impliqués qui veulent tout maîtriser.',
        cta:     'Commencer',
      },
      jallaVerify: {
        name:    'Jalla Verify',
        price:   '199 $',
        period:  ' / mois',
        tagline: 'Une vérification indépendante à chaque étape — pour payer en toute confiance.',
        cta:     'Démarrer Jalla Verify',
      },
      jallaManagement: {
        name:    'Jalla Management',
        price:   'Sur mesure',
        tagline: 'Service complet. Jalla gère votre projet de bout en bout.',
        cta:     'Nous contacter',
      },
    },
    features: {
      upTo3Projects:        "Jusqu'à 3 projets",
      selfApprove:          'Validez vous-même les étapes',
      evidenceUpload:       'Justificatifs par sous-étape',
      documentVault:        'Coffre-fort documentaire',
      projectChat:          'Messagerie de projet',
      oneContractor:        '1 entrepreneur par projet',
      jallaVerifiedStages:  'Étapes vérifiées par Jalla',
      unlimitedProjects:    'Projets illimités',
      dedicatedPM:          'Chef de projet dédié',
      unlimitedContractors: 'Entrepreneurs illimités',
      prioritySupport:      'Support prioritaire',
      everythingSelfVerify: 'Tout Self Verify',
      everythingJallaVerify:'Tout Jalla Verify',
      onSiteRep:            'Représentation sur le chantier',
      procurement:          'Supervision des achats',
      customReporting:      'Rapports personnalisés',
      whiteGlove:           'Accompagnement sur mesure',
    },
    faq: {
      q1: 'Que signifie « vérifié par Jalla » ?',
      a1: "Lorsque vous soumettez une étape pour révision, l'équipe Jalla examine les justificatifs téléversés — photos, factures, certifications — et confirme que les travaux sont conformes au cahier des charges avant que vous ne débloquiez le moindre paiement.",
      q2: 'Puis-je passer de Self Verify à un forfait supérieur plus tard ?',
      a2: "Oui. Le changement est immédiat — vos projets existants sont conservés et Jalla commence à examiner votre étape en cours dès le moment du changement.",
      q3: "Qu'advient-il de mes données si je résilie ?",
      a3: 'Vos données de projet, documents et justificatifs sont conservés pendant 90 jours après la résiliation. Vous pouvez tout exporter avant cette échéance.',
      q4: "Jalla Verify couvre-t-il les chantiers à l'international ?",
      a4: 'Oui. Jalla Verify est disponible sur tous les marchés couverts par Groundwork. La connaissance du terrain local est intégrée à chaque vérification.',
    },
  },

  // ── Communauté / liste d'attente ──────────────────────────
  community: {
    title:      'Rejoignez la communauté',
    body:       "Nous mettons la dernière main aux préparatifs. Rejoignez la communauté et soyez parmi les premiers à accéder à Groundwork dès le lancement.",
    fullName:   'Nom complet',
    namePlaceholder: 'Votre nom',
    email:      'Adresse e-mail',
    emailPlaceholder: 'vous@exemple.com',
    whereBuilding: 'Où construisez-vous ?',
    wherePlaceholder: 'ex. Douala, Cameroun',
    joinFree:   'Rejoindre gratuitement',
    joining:    'Inscription…',
    noSpam:     "Pas de spam. Uniquement l'accès anticipé et les actualités du lancement.",
    alreadyOnList: 'Vous êtes déjà inscrit.',
    successTitle:  'Vous y êtes.',
    successBody:   'Vous serez parmi les premiers informés du lancement de Groundwork. En attendant, rejoignez la communauté.',
    joinCommunity: 'Rejoindre la communauté',
    home:          'Accueil',
  },

  // ── Candidature entrepreneur ──────────────────────────────
  contractorApply: {
    backToHome: "Retour à l'accueil",
    cta: {
      badge:       'Candidatures Partenaire Fondateur ouvertes',
      title:       'Prêt à faire partie des premiers ?',
      subtitle:    "Rejoignez le Réseau de Construction Vérifié de Jalla et soyez mis en relation avec des projets de la diaspora financés qui paient à temps.",
      button:      'Postuler comme Partenaire Fondateur',
      formTitle:   'Candidature Partenaire Fondateur',
      formSubtitle:'Remplissez vos informations ci-dessous — environ 3 minutes.',
      formName:    'Formulaire entrepreneur',
      formEnglishOnly: "Ce formulaire de candidature n'est disponible qu'en anglais pour le moment. Une version française est en préparation — vous pouvez tout de même postuler ci-dessous, et notre équipe parle français.",
      perk1:       'Accès prioritaire aux projets financés de la diaspora',
      perk2:       'Des paiements liés à des jalons vérifiés — sans relance',
      perk3:       "Membre d'un réseau professionnel sélectionné",
      perk4:       'Badge Partenaire Fondateur sur votre profil',
      footnote:    "Jalla n'est pas une bourse d'emploi. C'est une infrastructure maîtrisée pour exécuter correctement les projets de construction de la diaspora, avec les bons professionnels, dans le bon ordre, avec les bonnes garanties.",
    },
    footer: {
      firm: 'THE FIRM',
    },
  },

  // ── Authentification ──────────────────────────────────────
  auth: {
    tagline:      'Protégez votre chantier.',
    taglineLine2: "Où que vous soyez.",
    login: {
      title:      'Connexion',
      subtitle:   'Bon retour. Reprenez où vous en étiez.',
      email:      'E-mail',
      password:   'Mot de passe',
      forgot:     'Mot de passe oublié ?',
      submit:     'Se connecter',
      submitting: 'Connexion…',
      google:     'Continuer avec Google',
      noAccount:  'Vous n’avez pas de compte ?',
      signUp:     "S'inscrire",
    },
    signup: {
      title:          'Inscription',
      titleInvite:    'Créez votre compte',
      subtitle:       'Rejoignez les bâtisseurs de la diaspora qui ne perdent jamais la trace de leur argent.',
      subtitleInvite: 'Définissez un mot de passe pour accepter votre invitation au projet.',
      fullName:       'Nom complet',
      email:          'E-mail',
      password:       'Mot de passe',
      confirmPassword:'Confirmer le mot de passe',
      submit:         'Créer un compte',
      submitting:     'Création du compte…',
      google:         'Continuer avec Google',
      haveAccount:    'Vous avez déjà un compte ?',
      logIn:          'Se connecter',
      check8:         'Au moins 8 caractères',
      checkUpper:     'Une lettre majuscule',
      checkNumber:    'Un chiffre',
      errRequirements:'Le mot de passe ne respecte pas les critères ci-dessous.',
      errMismatch:    'Les mots de passe ne correspondent pas.',
      errGeneric:     "L'inscription a échoué. Veuillez réessayer ou contacter le support.",
      checkEmailTitle:'Consultez vos e-mails',
      checkEmailBody: 'Nous avons envoyé un lien de confirmation à {email}. Cliquez dessus pour activer votre compte.',
      checkEmailInvite:'Après confirmation, vous serez dirigé directement vers le projet qui vous a été attribué.',
      backToLogin:    'Retour à la connexion',
    },
    reset: {
      title:      'Réinitialiser le mot de passe',
      subtitle:   'Nous vous enverrons un lien par e-mail pour vous reconnecter.',
      email:      'E-mail',
      submit:     'Envoyer le lien',
      submitting: 'Envoi…',
      sentTitle:  'Consultez vos e-mails',
      sentBody:   'Nous avons envoyé un lien de réinitialisation à {email}.',
      backToLogin:'Retour à la connexion',
    },
    callback: {
      signingIn:  'Connexion en cours…',
      errorTitle: "Une erreur s'est produite",
      backToLogin:'Retour à la connexion',
    },
  },

  // ── Intégration ───────────────────────────────────────────
  onboarding: {
    eyebrow:  'Configuration du compte',
    welcome:  'Bienvenue,',
    body:     'Préparons votre compte. Cela prend 30 secondes.',
    start:    'Commencer',
  },

  // ── Invitation entrepreneur ───────────────────────────────
  invite: {
    notFoundTitle: 'Invitation introuvable',
    notFoundBody:  "Ce lien d'invitation est invalide ou a déjà été utilisé.",
    goToGroundwork:'Aller sur Groundwork',
    acceptedTitle: 'Invitation déjà acceptée',
    acceptedBody:  'Cette invitation a déjà été utilisée. Connectez-vous pour accéder à votre projet.',
    title:         'Vous avez été invité',
    invitedBy:     '{inviter} vous a invité à collaborer sur {project}.',
    sentTo:        'Invitation envoyée à {email}',
    explainer:     "En tant qu'entrepreneur, vous pourrez téléverser les justificatifs d'avancement et échanger directement avec le maître d'ouvrage depuis le tableau de bord du projet.",
    loggedInAs:    'Connecté en tant que {email}',
    accept:        "Accepter l'invitation",
    accepting:     'Acceptation…',
    acceptError:   "Échec de l'acceptation de l'invitation.",
    createAccount: 'Créer un compte',
    haveAccount:   "J'ai déjà un compte",
  },

  // ── Tableau de bord ───────────────────────────────────────
  dashboard: {
    title:         'Tableau de bord',
    subtitle:      'Bon retour — votre chantier, vérifié et protégé.',
    goodMorning:   'Bonjour',
    goodAfternoon: 'Bon après-midi',
    goodEvening:   'Bonsoir',
    loadingBuilds: 'Chargement de vos chantiers…',
    noBuildsYet:   "Vous n'avez pas encore lancé de chantier. Changeons cela.",
    activeBuilds:  'Vous avez {count} chantier en cours.',
    activeBuilds_plural: 'Vous avez {count} chantiers en cours.',
    newProject:    'Nouveau projet',
    stats: {
      projects:      'Projets',
      totalBudget:   'Budget total',
      stagesDone:    'Étapes terminées',
      activeBuilds:  'Chantiers actifs',
      activeSuffix:  '{count} actif(s)',
      acrossAll:     'Tous projets confondus',
      percentDone:   '{pct} % terminé',
      noStages:      'Aucune étape',
      currentlyProgress: 'Actuellement en cours',
      totalPaid:     'Total payé',
      outstanding:   '{amount} restant dû',
      noPayments:    'Aucun paiement',
    },
    profileCompletion: {
      title:       'Complétez votre profil',
      subtitle:    'Débloquez tout Groundwork',
      accountCreated:  'Compte créé',
      nameSet:         'Nom affiché renseigné',
      idUploaded:      "Pièce d'identité téléversée",
      firstProject:    'Premier projet créé',
    },
    funnel: {
      journey:     'Votre parcours de construction',
      planning:    'Planification',
      planningAction:  'Créez votre premier projet',
      onboarding:  'Mise en route',
      onboardingAction:'Ouvrez un projet et ajoutez votre entrepreneur',
      earlyBuild:  'Début de chantier',
      earlyAction: 'Examinez les justificatifs téléversés par votre entrepreneur',
      activeBuild: 'Chantier actif',
      activeAction:"Vérifiez l'étape en cours et validez l'avancement",
      finishing:   'Finitions',
      finishingAction: 'Votre chantier touche à sa fin — préparez la réception',
      completed:   'Terminé',
      completedAction: 'Téléchargez le récapitulatif de votre projet',
    },
    velocity: {
      title:    "Rythme d'avancement",
      subtitle: 'Étapes terminées au fil du temps',
    },
    stageProgress: {
      title:       'Avancement des étapes',
      onTrack:     'Dans les temps',
      notStarted:  'Pas commencé',
      complete:    'Terminé',
      xOfY:        '{done} étapes terminées sur {total}',
      inProgress:  'en cours',
      upNext:      'à suivre',
      spent:       'Dépensé',
      active:      'En cours',
      remaining:   'Restant',
      done:        'Fait',
      awaitingApproval: 'En attente de validation',
      upcoming:    'À venir',
    },
    costing: {
      title:        'Répartition du budget',
      committed:    '{pct} % engagé sur les étapes terminées',
      loadingStages:'Chargement des étapes…',
      noneComplete: 'Aucune étape terminée pour le moment',
      total:        'Total',
      noBudget:     'Aucun budget',
      spent:        'Dépensé',
      spentDesc:    'Étapes terminées',
      active:       'En cours',
      activeDesc:   'En progression',
      remaining:    'Restant',
      remainingDesc:'Étapes à venir',
    },
    newsfeed: {
      title: 'Actualités de la plateforme',
    },
    tips: {
      createTitle:   'Créez un chantier',
      createDesc:    'Indiquez le type de projet, le lieu, les niveaux et les pièces.',
      contractorTitle:'Ajoutez votre entrepreneur',
      contractorDesc:"Invitez votre entrepreneur pour qu'il puisse téléverser les justificatifs du chantier.",
      approveTitle:  'Validez les étapes',
      approveDesc:   'Examinez et validez chaque étape au fur et à mesure de l’avancement.',
    },
    recentProjects: 'Projets récents',
    empty: {
      title:  'Lancez votre premier chantier',
      body:   'Suivez chaque étape, maîtrisez votre budget et restez en lien avec votre entrepreneur — au même endroit.',
      cta:    'Créer un chantier',
      contractor: "Aucun chantier attribué pour l'instant. Revenez une fois votre invitation confirmée.",
    },
    card: {
      stages:    '{done}/{total} étapes',
      estBudget: 'Budget estimé',
      open:      'Ouvrir',
    },
  },

  // ── Liste des projets ─────────────────────────────────────
  projects: {
    title:      'Mes chantiers',
    count:        '{count} chantier au total',
    count_plural: '{count} chantiers au total',
    newBuild:   'Nouveau chantier',
    starterUsed:'{used} / {limit} projets Self Verify utilisés',
    limitReached:'— limite atteinte',
    upgradeNudge:'Passer à Jalla Verify',
    filters: {
      all:       'Tous',
      active:    'Actifs',
      onHold:    'En pause',
      completed: 'Terminés',
    },
    stageOf:    'Étape {done} sur {total}',
    estBudget:  'Budget estimé',
    empty: {
      title: 'Lancez votre premier chantier',
      body:  'Suivez chaque étape, maîtrisez votre budget et restez en lien avec votre entrepreneur.',
      cta:   'Créer un chantier',
      contractor: 'Aucun chantier dans cette catégorie pour le moment.',
    },
  },

  // ── Forfaits ──────────────────────────────────────────────
  tiers: {
    selfVerify:      'Self Verify',
    jallaVerify:     'Jalla Verify',
    jallaManagement: 'Jalla Management',
  },
};
