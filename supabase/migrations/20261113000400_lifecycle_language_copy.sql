-- Reviewed lifecycle drafts: fill missing French copy and keep the original
-- default reminders constructive. Preserve all staff-written copy and enable flags.
BEGIN;
UPDATE public.lifecycle_sequence_steps AS step SET
 subject_fr=CASE WHEN btrim(step.subject_fr)='' THEN draft.subject_fr ELSE step.subject_fr END,
 body_fr=CASE WHEN btrim(step.body_fr)='' THEN draft.body_fr ELSE step.body_fr END,
 cta_label_fr=CASE WHEN btrim(step.cta_label_fr)='' THEN draft.cta_label_fr ELSE step.cta_label_fr END,
 subject_en=CASE WHEN step.subject_en=draft.original_subject THEN draft.subject_en ELSE step.subject_en END,
 body_en=CASE WHEN step.body_en=draft.original_body THEN draft.body_en ELSE step.body_en END
FROM jsonb_to_recordset($drafts$
[
  {
    "sequence_key": "cs_signup",
    "code": "CS01",
    "original_subject": "Welcome to Groundwork by Jalla",
    "original_body": "Hi {{first_name}},\n\nWelcome to Groundwork by Jalla. Groundwork helps you organize projects, milestones, documents, progress updates, and client communication in one place.\n\nYour next step is to complete your contractor onboarding so we can finish setting up your account.",
    "subject_en": "Welcome to Groundwork by Jalla",
    "body_en": "Hi {{first_name}},\n\nWelcome to Groundwork by Jalla. Groundwork helps you organize projects, milestones, documents, progress updates, and client communication in one place.\n\nYour next step is to complete your contractor onboarding so we can finish setting up your account.",
    "subject_fr": "Bienvenue sur Groundwork by Jalla",
    "body_fr": "Bonjour,\n\nFinalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "cs_signup",
    "code": "CS02",
    "original_subject": "Complete your Groundwork contractor onboarding",
    "original_body": "Hi {{first_name}},\n\nYou created your Groundwork account, but your contractor onboarding is not complete yet. Finish the remaining details to begin using Groundwork for your projects.",
    "subject_en": "Complete your Groundwork contractor onboarding",
    "body_en": "Hi {{first_name}},\n\nYou created your Groundwork account, but your contractor onboarding is not complete yet. Finish the remaining details to begin using Groundwork for your projects.",
    "subject_fr": "Terminez votre inscription comme entrepreneur",
    "body_fr": "Bonjour,\n\nFinalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "cs_signup",
    "code": "CS03",
    "original_subject": "Finish setting up your contractor account",
    "original_body": "Hi {{first_name}},\n\nCompleting your contractor onboarding gives you access to create projects, organize project information, and collaborate with clients through Groundwork.\n\nReturn to your onboarding and complete the remaining steps.",
    "subject_en": "Finish setting up your contractor account",
    "body_en": "Hi {{first_name}},\n\nCompleting your contractor onboarding gives you access to create projects, organize project information, and collaborate with clients through Groundwork.\n\nReturn to your onboarding and complete the remaining steps.",
    "subject_fr": "Finalisez votre compte entrepreneur",
    "body_fr": "Bonjour,\n\nFinalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "cs_signup",
    "code": "CS04",
    "original_subject": "Do you need help completing your Groundwork account?",
    "original_body": "Hi {{first_name}},\n\nYour contractor onboarding is still incomplete. If something is preventing you from finishing, reply to this email and tell us where you are stuck.\n\nYou can also return to Groundwork and complete the remaining steps now.",
    "subject_en": "Do you need help completing your Groundwork account?",
    "body_en": "Hi {{first_name}},\n\nYour contractor onboarding is still incomplete. If something is preventing you from finishing, reply to this email and tell us where you are stuck.\n\nYou can also return to Groundwork and complete the remaining steps now.",
    "subject_fr": "Un accompagnement pour finaliser votre compte ?",
    "body_fr": "Bonjour,\n\nNous pouvons vous accompagner pour finaliser votre inscription comme entrepreneur. Reprenez votre inscription à partir du lien ci-dessous et contactez Groundwork si vous souhaitez être guidé.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "cs_onboarded",
    "code": "CS05",
    "original_subject": "Your contractor onboarding is complete",
    "original_body": "Hi {{first_name}},\n\nYour contractor onboarding is complete. You now have standard contractor access to Groundwork and can use it to organize project information, milestones, documents, updates, and client communication.\n\nCreate your first project to begin.",
    "subject_en": "Your contractor onboarding is complete",
    "body_en": "Hi {{first_name}},\n\nYour contractor onboarding is complete. You now have standard contractor access to Groundwork and can use it to organize project information, milestones, documents, updates, and client communication.\n\nCreate your first project to begin.",
    "subject_fr": "Votre inscription comme entrepreneur est terminée",
    "body_fr": "Bonjour,\n\nVotre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cs_onboarded",
    "code": "CS06",
    "original_subject": "Create your first project on Groundwork",
    "original_body": "Hi {{first_name}},\n\nYour contractor account is ready. Add your first active project so you can begin organizing the work inside Groundwork.\n\nIf you do not currently have a project to add, select that option in Groundwork and we will stop these reminders.",
    "subject_en": "Create your first project on Groundwork",
    "body_en": "Hi {{first_name}},\n\nYour contractor account is ready. Add your first active project so you can begin organizing the work inside Groundwork.\n\nIf you do not currently have a project to add, select that option in Groundwork and we will stop these reminders.",
    "subject_fr": "Créez votre premier projet sur Groundwork",
    "body_fr": "Bonjour,\n\nVotre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cs_onboarded",
    "code": "CS07",
    "original_subject": "Bring your first project into Groundwork",
    "original_body": "Hi {{first_name}},\n\nA Groundwork project gives you one place for milestones, documents, progress updates, and communication with your client.\n\nCreate your first project when you are ready to begin organizing it.",
    "subject_en": "Bring your first project into Groundwork",
    "body_en": "Hi {{first_name}},\n\nA Groundwork project gives you one place for milestones, documents, progress updates, and communication with your client.\n\nCreate your first project when you are ready to begin organizing it.",
    "subject_fr": "Ajoutez votre projet de construction à Groundwork",
    "body_fr": "Bonjour,\n\nVotre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cs_onboarded",
    "code": "CS08",
    "original_subject": "Need help adding your first project?",
    "original_body": "Hi {{first_name}},\n\nYou have not created a project yet. If you have an active project and need help setting it up, reply to this email and our team can assist. If you do not currently have a project, update your account so we can move you into the appropriate communication track.",
    "subject_en": "Need help adding your first project?",
    "body_en": "Hi {{first_name}},\n\nYou have not created a project yet. If you have an active project and need help setting it up, reply to this email and our team can assist. If you do not currently have a project, update your account so we can move you into the appropriate communication track.",
    "subject_fr": "Un accompagnement pour ajouter votre premier projet ?",
    "body_fr": "Bonjour,\n\nVous pouvez reprendre la création de votre premier projet à tout moment. Le lien ci-dessous ouvre le formulaire. Contactez Groundwork si vous souhaitez être accompagné.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cs_project",
    "code": "CS09",
    "original_subject": "Your first Groundwork project has been created",
    "original_body": "Hi {{first_name}},\n\nCongratulations on creating {{project_name}} in Groundwork.\n\nThe next step is to invite your client. Once connected, your client can view the project information, milestones, documents, and updates you share. You control what your client see.",
    "subject_en": "Your first Groundwork project has been created",
    "body_en": "Hi {{first_name}},\n\nCongratulations on creating {{project_name}} in Groundwork.\n\nThe next step is to invite your client. Once connected, your client can view the project information, milestones, documents, and updates you share. You control what your client see.",
    "subject_fr": "Votre premier projet Groundwork est créé",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.",
    "cta_label_fr": "Inviter mon client"
  },
  {
    "sequence_key": "cs_project",
    "code": "CS10",
    "original_subject": "Invite your client to {{project_name}}",
    "original_body": "Hi {{first_name}},\n\n{{project_name}} is ready, but your client has not been invited yet. Connect them so they can follow the project through Groundwork.",
    "subject_en": "Invite your client to {{project_name}}",
    "body_en": "Hi {{first_name}},\n\n{{project_name}} is ready, but your client has not been invited yet. Connect them so they can follow the project through Groundwork.",
    "subject_fr": "Invitez votre client à {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.",
    "cta_label_fr": "Inviter mon client"
  },
  {
    "sequence_key": "cs_project",
    "code": "CS11",
    "original_subject": "Give your client visibility into {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nInviting your client creates a shared source of truth for project updates, documents, and milestones. It also reduces the need to distribute the same information across separate channels.",
    "subject_en": "Give your client visibility into {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nInviting your client creates a shared source of truth for project updates, documents, and milestones. It also reduces the need to distribute the same information across separate channels.",
    "subject_fr": "Partagez le suivi de {{project_name}} avec votre client",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.",
    "cta_label_fr": "Inviter mon client"
  },
  {
    "sequence_key": "cs_project",
    "code": "CS12",
    "original_subject": "Do you need help inviting your client?",
    "original_body": "Hi {{first_name}},\n\nYour project is not connected to a client yet. If you need help sending the invitation or explaining Groundwork to your client, reply to this email.\n\nP.S: Contractor using Groundwork to provide updates report higher client satisfaction and referrals",
    "subject_en": "Do you need help inviting your client?",
    "body_en": "Hi {{first_name}},\n\nYour project is not connected to a client yet. If you need help sending the invitation or explaining Groundwork to your client, reply to this email.\n\nP.S: Contractor using Groundwork to provide updates report higher client satisfaction and referrals",
    "subject_fr": "Un accompagnement pour inviter votre client ?",
    "body_fr": "Bonjour,\n\nNous pouvons vous accompagner pour inviter votre client sur {{project_name}}. Ouvrez les participants du projet pour retrouver le lien ou l’invitation et le partager directement avec votre client.",
    "cta_label_fr": "Inviter mon client"
  },
  {
    "sequence_key": "cs_client_pending",
    "code": "CS13",
    "original_subject": "Your invitation to {{client_name}} has been sent",
    "original_body": "Hi {{first_name}},\n\nYour invitation to {{client_name}} for {{project_name}} has been sent. We will let you know when the client accepts and joins the project.",
    "subject_en": "Your invitation to {{client_name}} has been sent",
    "body_en": "Hi {{first_name}},\n\nYour invitation to {{client_name}} for {{project_name}} has been sent. We will let you know when the client accepts and joins the project.",
    "subject_fr": "Votre invitation à {{client_name}} a été envoyée",
    "body_fr": "Bonjour,\n\nVotre invitation permet à {{client_name}} de rejoindre {{project_name}}. Ouvrez les participants du projet pour consulter son statut et partager le lien directement avec votre client.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cs_client_pending",
    "code": "CS14",
    "original_subject": "{{client_name}} has not joined {{project_name}} yet",
    "original_body": "Hi {{first_name}},\n\nYour client invitation is still pending. You may want to follow up directly, resend the invitation, or confirm that the email address is correct.",
    "subject_en": "Help {{client_name}} join {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYour invitation gives {{client_name}} a shared view of {{project_name}}. Open the project to review the invitation and share the link directly with your client.",
    "subject_fr": "Accompagnez {{client_name}} pour rejoindre {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation permet à {{client_name}} de rejoindre {{project_name}}. Ouvrez les participants du projet pour consulter son statut et partager le lien directement avec votre client.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cs_client_pending",
    "code": "CS15",
    "original_subject": "Your client invitation is still pending",
    "original_body": "Hi {{first_name}},\n\n{{client_name}} has not joined {{project_name}} yet. Resend the invitation, update the contact information, or reply if you need help\n\nonboarding the client.",
    "subject_en": "Follow up on your client invitation",
    "body_en": "Hi {{first_name}},\n\nIf {{client_name}} would like help joining {{project_name}}, Groundwork can guide you. Open the project to review the invitation and continue together.",
    "subject_fr": "Retrouvez votre invitation client",
    "body_fr": "Bonjour,\n\nSi {{client_name}} souhaite être accompagné pour rejoindre {{project_name}}, Groundwork peut vous guider. Retrouvez l’invitation dans les participants du projet pour poursuivre ensemble.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cs_connected",
    "code": "CS16",
    "original_subject": "{{client_name}} has joined {{project_name}}",
    "original_body": "Hi {{first_name}},\n\n{{client_name}} has joined {{project_name}}. Your project is now connected, and you can begin sharing updates, documents, milestones, and progress through Groundwork.",
    "subject_en": "{{client_name}} has joined {{project_name}}",
    "body_en": "Hi {{first_name}},\n\n{{client_name}} has joined {{project_name}}. Your project is now connected, and you can begin sharing updates, documents, milestones, and progress through Groundwork.",
    "subject_fr": "{{client_name}} a rejoint {{project_name}}",
    "body_fr": "Bonjour,\n\n{{client_name}} a rejoint {{project_name}}. Vous pouvez maintenant suivre les étapes du chantier, partager vos mises à jour et retrouver vos échanges dans le projet.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "ci_invited",
    "code": "CI01",
    "original_subject": "{{client_name}} invited you to {{project_name}} on Groundwork",
    "original_body": "Hi {{first_name}},\n\n{{client_name}} has invited you to collaborate on {{project_name}} through Groundwork by Jalla.\n\nAccept the invitation to view the project and collaborate with the client. If you already have a Groundwork account, sign in. If you are new, you will create an account before joining.",
    "subject_en": "{{client_name}} invited you to {{project_name}} on Groundwork",
    "body_en": "Hi {{first_name}},\n\n{{client_name}} has invited you to collaborate on {{project_name}} through Groundwork by Jalla.\n\nAccept the invitation to view the project and collaborate with the client. If you already have a Groundwork account, sign in. If you are new, you will create an account before joining.",
    "subject_fr": "{{client_name}} vous invite sur {{project_name}}",
    "body_fr": "Bonjour,\n\n{{client_name}} vous invite à rejoindre {{project_name}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "ci_invited",
    "code": "CI02",
    "original_subject": "Reminder: {{client_name}} invited you to {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYour invitation to {{project_name}} is waiting. Accept it to join the project and collaborate with {{client_name}} in Groundwork.",
    "subject_en": "Reminder: {{client_name}} invited you to {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYour invitation to {{project_name}} is waiting. Accept it to join the project and collaborate with {{client_name}} in Groundwork.",
    "subject_fr": "Rejoignez {{project_name}} avec {{client_name}}",
    "body_fr": "Bonjour,\n\n{{client_name}} vous invite à rejoindre {{project_name}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "ci_invited",
    "code": "CI03",
    "original_subject": "Join {{project_name}} on Groundwork",
    "original_body": "Hi {{first_name}},\n\nGroundwork gives you and {{client_name}} a shared place for project information, milestones, documents, and updates. Accept the invitation to join the existing project.",
    "subject_en": "Join {{project_name}} on Groundwork",
    "body_en": "Hi {{first_name}},\n\nGroundwork gives you and {{client_name}} a shared place for project information, milestones, documents, and updates. Accept the invitation to join the existing project.",
    "subject_fr": "Rejoignez {{project_name}} sur Groundwork",
    "body_fr": "Bonjour,\n\n{{client_name}} vous invite à rejoindre {{project_name}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "ci_invited",
    "code": "CI04",
    "original_subject": "Your invitation to {{project_name}} is still open",
    "original_body": "Hi {{first_name}},\n\nThis is the final reminder for your invitation to {{project_name}}. Accept it now or reply if you are having trouble accessing the project.",
    "subject_en": "Your invitation to {{project_name}} is still open",
    "body_en": "Hi {{first_name}},\n\nThis is the final reminder for your invitation to {{project_name}}. Accept it now or reply if you are having trouble accessing the project.",
    "subject_fr": "Votre lien pour rejoindre {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation à {{project_name}} vous permet de reprendre le projet avec {{client_name}}. Ouvrez le lien ci-dessous pour continuer. Contactez Groundwork si vous souhaitez être accompagné.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "ci_onboarding",
    "code": "CI05",
    "original_subject": "Complete your contractor setup to join {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYou accepted {{client_name}}'s invitation to {{project_name}}. Because this is your first Groundwork project, complete your contractor onboarding before joining the project.\n\nYou do not need to create another project. The client's project is already waiting for you.",
    "subject_en": "Complete your contractor setup to join {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYou accepted {{client_name}}'s invitation to {{project_name}}. Because this is your first Groundwork project, complete your contractor onboarding before joining the project.\n\nYou do not need to create another project. The client's project is already waiting for you.",
    "subject_fr": "Finalisez votre inscription pour rejoindre {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation à {{project_name}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{client_name}}.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "ci_onboarding",
    "code": "CI06",
    "original_subject": "Finish setting up your account for {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYour invitation has been accepted, but your contractor onboarding is incomplete. Finish the remaining steps to join {{project_name}}.",
    "subject_en": "Finish setting up your account for {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYour invitation has been accepted, but your contractor onboarding is incomplete. Finish the remaining steps to join {{project_name}}.",
    "subject_fr": "Terminez la configuration de votre compte pour {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation à {{project_name}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{client_name}}.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "ci_onboarding",
    "code": "CI07",
    "original_subject": "{{project_name}} is waiting for you",
    "original_body": "Hi {{first_name}},\n\nComplete your contractor onboarding to access the project {{client_name}} shared with you. You will be taken directly to the existing project once setup is complete.",
    "subject_en": "Continue joining {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nFinish your contractor setup to continue with {{project_name}}. Your invitation is already accepted, and you can resume from the button below.",
    "subject_fr": "Poursuivez votre inscription pour {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation à {{project_name}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{client_name}}.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "ci_onboarding",
    "code": "CI08",
    "original_subject": "Need help joining {{project_name}}?",
    "original_body": "Hi {{first_name}},\n\nYour contractor setup is still incomplete. Reply if you need assistance, or complete the remaining steps to join {{project_name}}.",
    "subject_en": "Need help joining {{project_name}}?",
    "body_en": "Hi {{first_name}},\n\nYour contractor setup is still incomplete. Reply if you need assistance, or complete the remaining steps to join {{project_name}}.",
    "subject_fr": "Un accompagnement pour rejoindre {{project_name}} ?",
    "body_fr": "Bonjour,\n\nReprenez votre inscription comme entrepreneur pour accéder à {{project_name}}. Groundwork peut vous accompagner si vous avez une question sur les informations à compléter.",
    "cta_label_fr": "Terminer mon inscription"
  },
  {
    "sequence_key": "ci_connected_existing",
    "code": "CI09",
    "original_subject": "You have joined {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.",
    "subject_en": "You have joined {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.",
    "subject_fr": "Vous avez rejoint {{project_name}}",
    "body_fr": "Bonjour,\n\nVous avez rejoint {{project_name}}. Ouvrez le projet pour retrouver ses étapes, ses documents et la conversation avec {{client_name}}.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "ci_connected_new",
    "code": "CI09",
    "original_subject": "You have joined {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.",
    "subject_en": "You have joined {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.",
    "subject_fr": "Vous avez rejoint {{project_name}}",
    "body_fr": "Bonjour,\n\nVous avez rejoint {{project_name}}. Ouvrez le projet pour retrouver ses étapes, ses documents et la conversation avec {{client_name}}.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cl_signup",
    "code": "CL01",
    "original_subject": "Welcome to Groundwork by Jalla",
    "original_body": "Hi {{first_name}},\n\nWelcome to Groundwork by Jalla. Groundwork gives you one place to organize your construction project, follow milestones, receive updates, and collaborate with your contractor.\n\nCreate your first project to begin.",
    "subject_en": "Welcome to Groundwork by Jalla",
    "body_en": "Hi {{first_name}},\n\nWelcome to Groundwork by Jalla. Groundwork gives you one place to organize your construction project, follow milestones, receive updates, and collaborate with your contractor.\n\nCreate your first project to begin.",
    "subject_fr": "Bienvenue sur Groundwork by Jalla",
    "body_fr": "Bonjour,\n\nCréez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cl_signup",
    "code": "CL02",
    "original_subject": "Create your first Groundwork project",
    "original_body": "Hi {{first_name}},\n\nYour Groundwork account is ready, but you have not created a project yet. Add your project so you can begin organizing the build and connecting the people involved.",
    "subject_en": "Create your first Groundwork project",
    "body_en": "Hi {{first_name}},\n\nYour Groundwork account is ready, but you have not created a project yet. Add your project so you can begin organizing the build and connecting the people involved.",
    "subject_fr": "Créez votre premier projet Groundwork",
    "body_fr": "Bonjour,\n\nCréez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cl_signup",
    "code": "CL03",
    "original_subject": "Bring your construction project into Groundwork",
    "original_body": "Hi {{first_name}},\n\nCreating your project gives you a shared place for milestones, documents, progress updates, and communication with your contractor.",
    "subject_en": "Bring your construction project into Groundwork",
    "body_en": "Hi {{first_name}},\n\nCreating your project gives you a shared place for milestones, documents, progress updates, and communication with your contractor.",
    "subject_fr": "Ajoutez votre projet de construction à Groundwork",
    "body_fr": "Bonjour,\n\nCréez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cl_signup",
    "code": "CL04",
    "original_subject": "Need help creating your project?",
    "original_body": "Hi {{first_name}},\n\nYou have not created a project yet. If you need help entering the project details, reply to this email and our team can assist.",
    "subject_en": "Need help creating your project?",
    "body_en": "Hi {{first_name}},\n\nYou have not created a project yet. If you need help entering the project details, reply to this email and our team can assist.",
    "subject_fr": "Un accompagnement pour créer votre projet ?",
    "body_fr": "Bonjour,\n\nVous pouvez reprendre la création de votre projet à partir du lien ci-dessous. Groundwork peut vous accompagner pour organiser les informations de votre chantier.",
    "cta_label_fr": "Créer mon projet"
  },
  {
    "sequence_key": "cl_project",
    "code": "CL05",
    "original_subject": "Your first Groundwork project has been created",
    "original_body": "Hi {{first_name}},\n\nCongratulations on creating {{project_name}}.\n\nYour next step is to connect the professional responsible for the work. Invite your existing contractor, or request help from Jalla if you do not have one yet.",
    "subject_en": "Your first Groundwork project has been created",
    "body_en": "Hi {{first_name}},\n\nCongratulations on creating {{project_name}}.\n\nYour next step is to connect the professional responsible for the work. Invite your existing contractor, or request help from Jalla if you do not have one yet.",
    "subject_fr": "Votre premier projet Groundwork est créé",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.",
    "cta_label_fr": "Inviter mon entrepreneur"
  },
  {
    "sequence_key": "cl_project",
    "code": "CL06",
    "original_subject": "Connect a contractor to {{project_name}}",
    "original_body": "Hi {{first_name}},\n\n{{project_name}} is ready, but no contractor is connected yet. Invite your contractor or request help finding an appropriate professional.",
    "subject_en": "Connect a contractor to {{project_name}}",
    "body_en": "Hi {{first_name}},\n\n{{project_name}} is ready, but no contractor is connected yet. Invite your contractor or request help finding an appropriate professional.",
    "subject_fr": "Invitez un entrepreneur sur {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.",
    "cta_label_fr": "Inviter mon entrepreneur"
  },
  {
    "sequence_key": "cl_project",
    "code": "CL07",
    "original_subject": "Your project needs a contractor",
    "original_body": "Hi {{first_name}},\n\nA connected contractor can share project information, documents, milestones, and progress updates with you through Groundwork. If you don’t have a contractor, reply to this email and Jalla will help you find one",
    "subject_en": "Connect your contractor to {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nInvite your contractor to {{project_name}} so you can follow project stages, review updates and keep your conversation together.",
    "subject_fr": "Retrouvez votre entrepreneur sur {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre projet {{project_name}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.",
    "cta_label_fr": "Inviter mon entrepreneur"
  },
  {
    "sequence_key": "cl_project",
    "code": "CL08",
    "original_subject": "Do you need help connecting a contractor?",
    "original_body": "Hi {{first_name}},\n\n{{project_name}} is not connected to a contractor yet. Invite the professional you already work with, or request support from Jalla if you need assistance.",
    "subject_en": "Do you need help connecting a contractor?",
    "body_en": "Hi {{first_name}},\n\n{{project_name}} is not connected to a contractor yet. Invite the professional you already work with, or request support from Jalla if you need assistance.",
    "subject_fr": "Un accompagnement pour inviter votre entrepreneur ?",
    "body_fr": "Bonjour,\n\nGroundwork peut vous accompagner pour inviter votre entrepreneur sur {{project_name}}. Retrouvez les participants du projet à partir du lien ci-dessous pour poursuivre.",
    "cta_label_fr": "Inviter mon entrepreneur"
  },
  {
    "sequence_key": "cl_support",
    "code": "CL09",
    "original_subject": "We received your contractor support request",
    "original_body": "Hi {{first_name}},\n\nWe received your request for help connecting a contractor to {{project_name}}. A member of the Jalla team will review the project information and contact you about the next step.\n\nThis request does not guarantee an immediate match or appointment. Any professional engagement will remain subject to availability, fit, client choice, and applicable terms.",
    "subject_en": "We received your contractor support request",
    "body_en": "Hi {{first_name}},\n\nWe received your request for help connecting a contractor to {{project_name}}. A member of the Jalla team will review the project information and contact you about the next step.\n\nThis request does not guarantee an immediate match or appointment. Any professional engagement will remain subject to availability, fit, client choice, and applicable terms.",
    "subject_fr": "Votre demande d’accompagnement a été reçue",
    "body_fr": "Bonjour,\n\nVotre demande d’accompagnement pour trouver un entrepreneur a été reçue. L’équipe Groundwork pourra examiner votre besoin et vous aider à préparer la suite de votre projet.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cl_contractor_pending",
    "code": "CL10",
    "original_subject": "Your invitation to {{contractor_name}} has been sent",
    "original_body": "Hi {{first_name}},\n\nYour invitation to {{contractor_name}} for {{project_name}} has been sent. We will let you know when the contractor accepts and joins the project.",
    "subject_en": "Your invitation to {{contractor_name}} has been sent",
    "body_en": "Hi {{first_name}},\n\nYour invitation to {{contractor_name}} for {{project_name}} has been sent. We will let you know when the contractor accepts and joins the project.",
    "subject_fr": "Votre invitation à {{contractor_name}} a été envoyée",
    "body_fr": "Bonjour,\n\nVotre invitation permet à {{contractor_name}} de rejoindre {{project_name}}. Ouvrez les participants pour consulter son statut et partager le lien directement avec votre entrepreneur.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cl_contractor_pending",
    "code": "CL11",
    "original_subject": "{{contractor_name}} has not joined {{project_name}} yet",
    "original_body": "Hi {{first_name}},\n\nYour contractor invitation is still pending. You may follow up directly, resend the invitation, or confirm the email address.",
    "subject_en": "Help {{contractor_name}} join {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYour invitation gives {{contractor_name}} access to {{project_name}}. Open the project to review the invitation and share the link directly with your contractor.",
    "subject_fr": "Accompagnez {{contractor_name}} pour rejoindre {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation permet à {{contractor_name}} de rejoindre {{project_name}}. Ouvrez les participants pour consulter son statut et partager le lien directement avec votre entrepreneur.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cl_contractor_pending",
    "code": "CL12",
    "original_subject": "Your contractor invitation is still pending",
    "original_body": "Hi {{first_name}},\n\n{{contractor_name}} has not joined {{project_name}}. Resend the invitation, update the contact information, or request help from Jalla.",
    "subject_en": "Follow up on your contractor invitation",
    "body_en": "Hi {{first_name}},\n\nIf {{contractor_name}} would like help joining {{project_name}}, Groundwork can guide you. Open the project to review the invitation and continue together.",
    "subject_fr": "Retrouvez votre invitation entrepreneur",
    "body_fr": "Bonjour,\n\nSi {{contractor_name}} souhaite être accompagné pour rejoindre {{project_name}}, Groundwork peut vous guider. Retrouvez l’invitation dans les participants du projet pour poursuivre ensemble.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "cl_connected",
    "code": "CL13",
    "original_subject": "{{contractor_name}} has joined {{project_name}}",
    "original_body": "Hi {{first_name}},\n\n{{contractor_name}} has joined {{project_name}}. Your project is now connected, and you can collaborate through Groundwork as information, milestones, documents, and updates are added.",
    "subject_en": "{{contractor_name}} has joined {{project_name}}",
    "body_en": "Hi {{first_name}},\n\n{{contractor_name}} has joined {{project_name}}. Your project is now connected, and you can collaborate through Groundwork as information, milestones, documents, and updates are added.",
    "subject_fr": "{{contractor_name}} a rejoint {{project_name}}",
    "body_fr": "Bonjour,\n\n{{contractor_name}} a rejoint {{project_name}}. Vous pouvez suivre les étapes, examiner les mises à jour de votre entrepreneur et retrouver les échanges dans le projet.",
    "cta_label_fr": "Ouvrir le projet"
  },
  {
    "sequence_key": "iv_invited",
    "code": "IV01",
    "original_subject": "{{contractor_name}} invited you to view {{project_name}}",
    "original_body": "Hi {{first_name}},\n\n{{contractor_name}} has invited you to join {{project_name}} on Groundwork by Jalla.\n\nAccept the invitation to view the existing project, including information, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view project.",
    "subject_en": "{{contractor_name}} invited you to view {{project_name}}",
    "body_en": "Hi {{first_name}},\n\n{{contractor_name}} has invited you to join {{project_name}} on Groundwork by Jalla.\n\nAccept the invitation to view the existing project, including information, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view project.",
    "subject_fr": "{{contractor_name}} vous invite sur {{project_name}}",
    "body_fr": "Bonjour,\n\n{{contractor_name}} vous invite à rejoindre {{project_name}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "iv_invited",
    "code": "IV02",
    "original_subject": "Reminder: join {{project_name}} on Groundwork",
    "original_body": "Hi {{first_name}},\n\nYour invitation to {{project_name}} is waiting. Accept it to connect with {{contractor_name}} and view the project through Groundwork.",
    "subject_en": "Reminder: join {{project_name}} on Groundwork",
    "body_en": "Hi {{first_name}},\n\nYour invitation to {{project_name}} is waiting. Accept it to connect with {{contractor_name}} and view the project through Groundwork.",
    "subject_fr": "Rejoignez {{project_name}} sur Groundwork",
    "body_fr": "Bonjour,\n\n{{contractor_name}} vous invite à rejoindre {{project_name}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "iv_invited",
    "code": "IV03",
    "original_subject": "Get visibility into {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nGroundwork gives you and {{contractor_name}} a shared place for project information, documents, milestones, and progress updates. Accept the invitation to join your project.",
    "subject_en": "Get visibility into {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nGroundwork gives you and {{contractor_name}} a shared place for project information, documents, milestones, and progress updates. Accept the invitation to join your project.",
    "subject_fr": "Suivez l’avancement de {{project_name}}",
    "body_fr": "Bonjour,\n\n{{contractor_name}} vous invite à rejoindre {{project_name}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "iv_invited",
    "code": "IV04",
    "original_subject": "Your invitation to {{project_name}} is still open",
    "original_body": "Hi {{first_name}},\n\nThis is the final automated reminder for your invitation to {{project_name}}. Accept it now or reply if you need help accessing the project.",
    "subject_en": "Your invitation to {{project_name}} is still open",
    "body_en": "Hi {{first_name}},\n\nThis is the final automated reminder for your invitation to {{project_name}}. Accept it now or reply if you need help accessing the project.",
    "subject_fr": "Votre lien pour rejoindre {{project_name}}",
    "body_fr": "Bonjour,\n\nVotre invitation vous permet de suivre {{project_name}} avec {{contractor_name}}. Ouvrez le lien ci-dessous pour continuer. Contactez Groundwork si vous souhaitez être accompagné.",
    "cta_label_fr": "Accepter l’invitation"
  },
  {
    "sequence_key": "iv_connected",
    "code": "IV05",
    "original_subject": "You have joined {{project_name}}",
    "original_body": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{contractor_name}}. Open the project to review the available information and follow updates through Groundwork.\n\nYou do not need to create another project. The project shared with you is already active in your account.",
    "subject_en": "You have joined {{project_name}}",
    "body_en": "Hi {{first_name}},\n\nYou are now connected to {{project_name}} with {{contractor_name}}. Open the project to review the available information and follow updates through Groundwork.\n\nYou do not need to create another project. The project shared with you is already active in your account.",
    "subject_fr": "Vous avez rejoint {{project_name}}",
    "body_fr": "Bonjour,\n\nVous avez rejoint {{project_name}} comme client. Ouvrez le projet pour suivre les étapes, examiner les mises à jour de votre entrepreneur et retrouver les documents et les échanges.",
    "cta_label_fr": "Ouvrir le projet"
  }
]
$drafts$::jsonb) AS draft(sequence_key text,code text,original_subject text,original_body text,subject_en text,body_en text,subject_fr text,body_fr text,cta_label_fr text)
WHERE step.sequence_key=draft.sequence_key AND step.code=draft.code;
COMMIT;
