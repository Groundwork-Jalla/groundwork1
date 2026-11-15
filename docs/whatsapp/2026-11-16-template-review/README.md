# Groundwork WhatsApp reminder copy for Meta review

Prepared on 16 November 2026 from the saved Groundwork lifecycle steps. Following owner approval, all **86 variants were submitted to Meta** and verified at **06:15 Malaysia time**. At that read, all 86 were **PENDING**, with no approved or rejected Groundwork variants. No messages were sent; sending stays off.

The JSON packs and copy below preserve the original pre-submission review snapshot. Meta required a fixed closing sentence for six variants whose final parameter was followed only by punctuation; see the exact [format corrections](format-corrections.json). Those corrections also run in the shared application compiler, so export, approval matching and message logs agree. Saved email copy, variables and destinations are unchanged.

The [submission receipt](submission-receipt.json) records the real template IDs, categories and review statuses. Meta assigned 62 variants to UTILITY and 24 to MARKETING; translations were submitted under their template name’s existing Meta category. This creates provider records only and changes no billing settings. Deploy the matching application fixes before checking these definitions in Admin or enabling any delivery.

There are 43 distinct reminder names, each in English and French: 86 template variants. Body wording follows the saved journeys, with email reply wording adapted to WhatsApp. The two original long English button labels become “Complete onboarding” and “Accept invitation”; their destinations remain unchanged.

The original requests start with the UTILITY category and allow Meta to change it under its own classification. The submission receipt records the resulting categories. Category and approval are decided by Meta. Approval does not enable Groundwork sending.

Six exact uncoded placeholder rows left by the old seed are excluded from WhatsApp export and due-step selection. Custom uncoded steps still report a validation issue. No saved rows or email copy were deleted or modified. Review those underlying placeholder rows before enabling the separate email journeys.

JSON request packs: [English](templates-en.json), [French](templates-fr.json). Each item in `requests` preserves the original proposed POST body for the configured production account’s `message_templates` endpoint; apply the linked format corrections and Meta-assigned name category when comparing with the submission receipt.

## Template copy

### groundwork_cs05 · en

Hi {{1}},

Your contractor onboarding is complete. You now have standard contractor access to Groundwork and can use it to organize project information, milestones, documents, updates, and client communication.

Create your first project to begin.

Footer: Reply STOP to stop reminders.

Button: **Create your first project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl09 · en

Hi {{1}},

We received your request for help connecting a contractor to {{2}}. A member of the Jalla team will review the project information and contact you about the next step.

This request does not guarantee an immediate match or appointment. Any professional engagement will remain subject to availability, fit, client choice, and applicable terms.

Footer: Reply STOP to stop reminders.

Button: **View project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl05 · en

Hi {{1}},

Congratulations on creating {{2}}.

Your next step is to connect the professional responsible for the work. Invite your existing contractor, or request help from Jalla if you do not have one yet.

Footer: Reply STOP to stop reminders.

Button: **Connect a contractor** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl01 · en

Hi {{1}},

Welcome to Groundwork by Jalla. Groundwork gives you one place to organize your construction project, follow milestones, receive updates, and collaborate with your contractor.

Create your first project to begin.

Footer: Reply STOP to stop reminders.

Button: **Create your first project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs09 · en

Hi {{1}},

Congratulations on creating {{2}} in Groundwork.

The next step is to invite your client. Once connected, your client can view the project information, milestones, documents, and updates you share. You control what your client see.

Footer: Reply STOP to stop reminders.

Button: **Invite your client** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv05 · en

Hi {{1}},

You are now connected to {{2}} with {{3}}. Open the project to review the available information and follow updates through Groundwork.

You do not need to create another project. The project shared with you is already active in your account.

Footer: Reply STOP to stop reminders.

Button: **Open project** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci09 · en

Hi {{1}},

You are now connected to {{2}} with {{3}}. Open the project to review its information and begin collaborating through Groundwork.

Footer: Reply STOP to stop reminders.

Button: **Open project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs13 · en

Hi {{1}},

Your invitation to {{2}} for {{3}} has been sent. We will let you know when the client accepts and joins the project.

Footer: Reply STOP to stop reminders.

Button: **View project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs16 · en

Hi {{1}},

{{2}} has joined {{3}}. Your project is now connected, and you can begin sharing updates, documents, milestones, and progress through Groundwork.

Footer: Reply STOP to stop reminders.

Button: **Open project** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci01 · en

Hi {{1}},

{{2}} has invited you to collaborate on {{3}} through Groundwork by Jalla.

Accept the invitation to view the project and collaborate with the client. If you already have a Groundwork account, sign in. If you are new, you will create an account before joining.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv01 · en

Hi {{1}},

{{2}} has invited you to join {{3}} on Groundwork by Jalla.

Accept the invitation to view the existing project, including information, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view project.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci05 · en

Hi {{1}},

You accepted {{2}}'s invitation to {{3}}. Because this is your first Groundwork project, complete your contractor onboarding before joining the project.

You do not need to create another project. The client's project is already waiting for you.

Footer: Reply STOP to stop reminders.

Button: **Complete onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl10 · en

Hi {{1}},

Your invitation to {{2}} for {{3}} has been sent. We will let you know when the contractor accepts and joins the project.

Footer: Reply STOP to stop reminders.

Button: **View project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl13 · en

Hi {{1}},

{{2}} has joined {{3}}. Your project is now connected, and you can collaborate through Groundwork as information, milestones, documents, and updates are added.

Footer: Reply STOP to stop reminders.

Button: **Open project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs01 · en

Hi {{1}},

Welcome to Groundwork by Jalla. Groundwork helps you organize projects, milestones, documents, progress updates, and client communication in one place.

Your next step is to complete your contractor onboarding so we can finish setting up your account.

Footer: Reply STOP to stop reminders.

Button: **Complete onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl02 · en

Hi {{1}},

Your Groundwork account is ready, but you have not created a project yet. Add your project so you can begin organizing the build and connecting the people involved.

Footer: Reply STOP to stop reminders.

Button: **Create project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs02 · en

Hi {{1}},

You created your Groundwork account, but your contractor onboarding is not complete yet. Finish the remaining details to begin using Groundwork for your projects.

Footer: Reply STOP to stop reminders.

Button: **Continue onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl11 · en

Hi {{1}},

Your invitation gives {{2}} access to {{3}}. Open the project to review the invitation and share the link directly with your contractor.

Footer: Reply STOP to stop reminders.

Button: **Review invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs14 · en

Hi {{1}},

Your invitation gives {{2}} a shared view of {{3}}. Open the project to review the invitation and share the link directly with your client.

Footer: Reply STOP to stop reminders.

Button: **Review invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs06 · en

Hi {{1}},

Your contractor account is ready. Add your first active project so you can begin organizing the work inside Groundwork.

If you do not currently have a project to add, select that option in Groundwork and we will stop these reminders.

Footer: Reply STOP to stop reminders.

Button: **Create a project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs10 · en

Hi {{1}},

{{2}} is ready, but your client has not been invited yet. Connect them so they can follow the project through Groundwork.

Footer: Reply STOP to stop reminders.

Button: **Invite client** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci02 · en

Hi {{1}},

Your invitation to {{2}} is waiting. Accept it to join the project and collaborate with {{3}} in Groundwork.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci06 · en

Hi {{1}},

Your invitation has been accepted, but your contractor onboarding is incomplete. Finish the remaining steps to join {{2}}.

Footer: Reply STOP to stop reminders.

Button: **Continue onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl06 · en

Hi {{1}},

{{2}} is ready, but no contractor is connected yet. Invite your contractor or request help finding an appropriate professional.

Footer: Reply STOP to stop reminders.

Button: **Connect a contractor** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv02 · en

Hi {{1}},

Your invitation to {{2}} is waiting. Accept it to connect with {{3}} and view the project through Groundwork.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci07 · en

Hi {{1}},

Finish your contractor setup to continue with {{2}}. Your invitation is already accepted, and you can resume from the button below.

Footer: Reply STOP to stop reminders.

Button: **Finish onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs15 · en

Hi {{1}},

If {{2}} would like help joining {{3}}, Groundwork can guide you. Open the project to review the invitation and continue together.

Footer: Reply STOP to stop reminders.

Button: **Manage invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl03 · en

Hi {{1}},

Creating your project gives you a shared place for milestones, documents, progress updates, and communication with your contractor.

Footer: Reply STOP to stop reminders.

Button: **Create project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs07 · en

Hi {{1}},

A Groundwork project gives you one place for milestones, documents, progress updates, and communication with your client.

Create your first project when you are ready to begin organizing it.

Footer: Reply STOP to stop reminders.

Button: **Create a project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl07 · en

Hi {{1}},

Invite your contractor to {{2}} so you can follow project stages, review updates and keep your conversation together.

Footer: Reply STOP to stop reminders.

Button: **Connect a contractor** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl12 · en

Hi {{1}},

If {{2}} would like help joining {{3}}, Groundwork can guide you. Open the project to review the invitation and continue together.

Footer: Reply STOP to stop reminders.

Button: **Manage invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs03 · en

Hi {{1}},

Completing your contractor onboarding gives you access to create projects, organize project information, and collaborate with clients through Groundwork.

Return to your onboarding and complete the remaining steps.

Footer: Reply STOP to stop reminders.

Button: **Finish onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci03 · en

Hi {{1}},

Groundwork gives you and {{2}} a shared place for project information, milestones, documents, and updates. Accept the invitation to join the existing project.

Footer: Reply STOP to stop reminders.

Button: **Join project** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv03 · en

Hi {{1}},

Groundwork gives you and {{2}} a shared place for project information, documents, milestones, and progress updates. Accept the invitation to join your project.

Footer: Reply STOP to stop reminders.

Button: **Join project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs11 · en

Hi {{1}},

Inviting your client creates a shared source of truth for project updates, documents, and milestones. It also reduces the need to distribute the same information across separate channels.

Footer: Reply STOP to stop reminders.

Button: **Invite client** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci08 · en

Hi {{1}},

Your contractor setup is still incomplete. Reply if you need assistance, or complete the remaining steps to join {{2}}.

Footer: Reply STOP to stop reminders.

Button: **Complete setup** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs12 · en

Hi {{1}},

Your project is not connected to a client yet. If you need help sending the invitation or explaining Groundwork to your client, reply to this message.

P.S: Contractor using Groundwork to provide updates report higher client satisfaction and referrals

Footer: Reply STOP to stop reminders.

Button: **Invite client** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv04 · en

Hi {{1}},

This is the final automated reminder for your invitation to {{2}}. Accept it now or reply if you need help accessing the project.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs08 · en

Hi {{1}},

You have not created a project yet. If you have an active project and need help setting it up, reply to this message and our team can assist. If you do not currently have a project, update your account so we can move you into the appropriate communication track.

Footer: Reply STOP to stop reminders.

Button: **Add a project** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs04 · en

Hi {{1}},

Your contractor onboarding is still incomplete. If something is preventing you from finishing, reply to this message and tell us where you are stuck.

You can also return to Groundwork and complete the remaining steps now.

Footer: Reply STOP to stop reminders.

Button: **Complete onboarding** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl08 · en

Hi {{1}},

{{2}} is not connected to a contractor yet. Invite the professional you already work with, or request support from Jalla if you need assistance.

Footer: Reply STOP to stop reminders.

Button: **Choose contractor option** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl04 · en

Hi {{1}},

You have not created a project yet. If you need help entering the project details, reply to this message and our team can assist.

Footer: Reply STOP to stop reminders.

Button: **Create project** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci04 · en

Hi {{1}},

This is the final reminder for your invitation to {{2}}. Accept it now or reply if you are having trouble accessing the project.

Footer: Reply STOP to stop reminders.

Button: **Accept invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs05 · fr

Bonjour,

Votre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl09 · fr

Bonjour,

Votre demande d’accompagnement pour trouver un entrepreneur a été reçue. L’équipe Groundwork pourra examiner votre besoin et vous aider à préparer la suite de votre projet.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl05 · fr

Bonjour,

Votre projet {{1}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon entrepreneur** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl01 · fr

Bonjour,

Créez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs09 · fr

Bonjour,

Votre projet {{1}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon client** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv05 · fr

Bonjour,

Vous avez rejoint {{1}} comme client. Ouvrez le projet pour suivre les étapes, examiner les mises à jour de votre entrepreneur et retrouver les documents et les échanges.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci09 · fr

Bonjour,

Vous avez rejoint {{1}}. Ouvrez le projet pour retrouver ses étapes, ses documents et la conversation avec {{2}}.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs13 · fr

Bonjour,

Votre invitation permet à {{1}} de rejoindre {{2}}. Ouvrez les participants du projet pour consulter son statut et partager le lien directement avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs16 · fr

Bonjour,

{{1}} a rejoint {{2}}. Vous pouvez maintenant suivre les étapes du chantier, partager vos mises à jour et retrouver vos échanges dans le projet.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci01 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv01 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci05 · fr

Bonjour,

Votre invitation à {{1}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{2}}.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl10 · fr

Bonjour,

Votre invitation permet à {{1}} de rejoindre {{2}}. Ouvrez les participants pour consulter son statut et partager le lien directement avec votre entrepreneur.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl13 · fr

Bonjour,

{{1}} a rejoint {{2}}. Vous pouvez suivre les étapes, examiner les mises à jour de votre entrepreneur et retrouver les échanges dans le projet.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs01 · fr

Bonjour,

Finalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl02 · fr

Bonjour,

Créez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs02 · fr

Bonjour,

Finalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl11 · fr

Bonjour,

Votre invitation permet à {{1}} de rejoindre {{2}}. Ouvrez les participants pour consulter son statut et partager le lien directement avec votre entrepreneur.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs14 · fr

Bonjour,

Votre invitation permet à {{1}} de rejoindre {{2}}. Ouvrez les participants du projet pour consulter son statut et partager le lien directement avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs06 · fr

Bonjour,

Votre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs10 · fr

Bonjour,

Votre projet {{1}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon client** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci02 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci06 · fr

Bonjour,

Votre invitation à {{1}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{2}}.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl06 · fr

Bonjour,

Votre projet {{1}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon entrepreneur** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv02 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci07 · fr

Bonjour,

Votre invitation à {{1}} est acceptée. Finalisez votre inscription comme entrepreneur pour retrouver le projet et commencer à travailler avec {{2}}.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs15 · fr

Bonjour,

Si {{1}} souhaite être accompagné pour rejoindre {{2}}, Groundwork peut vous guider. Retrouvez l’invitation dans les participants du projet pour poursuivre ensemble.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl03 · fr

Bonjour,

Créez votre premier projet sur Groundwork pour réunir les étapes de votre chantier, les documents et les échanges avec votre entrepreneur. Vous pouvez ajouter votre bordereau de quantités si vous en avez un.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs07 · fr

Bonjour,

Votre compte entrepreneur vous permet d’ajouter votre premier projet. Indiquez les informations du chantier et ajoutez votre bordereau de quantités si vous en avez un pour préparer le suivi avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl07 · fr

Bonjour,

Votre projet {{1}} est prêt à accueillir votre entrepreneur. Ouvrez les participants pour créer un lien de projet ou envoyer une invitation par e-mail et suivre le chantier ensemble.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon entrepreneur** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl12 · fr

Bonjour,

Si {{1}} souhaite être accompagné pour rejoindre {{2}}, Groundwork peut vous guider. Retrouvez l’invitation dans les participants du projet pour poursuivre ensemble.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Ouvrir le projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs03 · fr

Bonjour,

Finalisez votre inscription comme entrepreneur pour préparer votre premier projet sur Groundwork. Vous pourrez réunir les étapes, les documents et les échanges avec votre client au même endroit.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci03 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme entrepreneur. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver ce projet existant.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv03 · fr

Bonjour,

{{1}} vous invite à rejoindre {{2}} comme client. Ouvrez votre invitation, puis connectez-vous ou créez un compte Groundwork pour retrouver le projet existant et suivre le chantier.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs11 · fr

Bonjour,

Votre projet {{1}} est prêt à être partagé avec votre client. Ouvrez la section des participants et créez un lien de projet ou envoyez une invitation par e-mail. Votre client pourra suivre le chantier et examiner vos mises à jour.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon client** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci08 · fr

Bonjour,

Reprenez votre inscription comme entrepreneur pour accéder à {{1}}. Groundwork peut vous accompagner si vous avez une question sur les informations à compléter.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs12 · fr

Bonjour,

Nous pouvons vous accompagner pour inviter votre client sur {{1}}. Ouvrez les participants du projet pour retrouver le lien ou l’invitation et le partager directement avec votre client.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon client** → `https://www.tryjalla.com/{{1}}`

### groundwork_iv04 · fr

Bonjour,

Votre invitation vous permet de suivre {{1}} avec {{2}}. Ouvrez le lien ci-dessous pour continuer. Contactez Groundwork si vous souhaitez être accompagné.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs08 · fr

Bonjour,

Vous pouvez reprendre la création de votre premier projet à tout moment. Le lien ci-dessous ouvre le formulaire. Contactez Groundwork si vous souhaitez être accompagné.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_cs04 · fr

Bonjour,

Nous pouvons vous accompagner pour finaliser votre inscription comme entrepreneur. Reprenez votre inscription à partir du lien ci-dessous et contactez Groundwork si vous souhaitez être guidé.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Terminer mon inscription** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl08 · fr

Bonjour,

Groundwork peut vous accompagner pour inviter votre entrepreneur sur {{1}}. Retrouvez les participants du projet à partir du lien ci-dessous pour poursuivre.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Inviter mon entrepreneur** → `https://www.tryjalla.com/{{1}}`

### groundwork_cl04 · fr

Bonjour,

Vous pouvez reprendre la création de votre projet à partir du lien ci-dessous. Groundwork peut vous accompagner pour organiser les informations de votre chantier.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Créer mon projet** → `https://www.tryjalla.com/{{1}}`

### groundwork_ci04 · fr

Bonjour,

Votre invitation à {{1}} vous permet de reprendre le projet avec {{2}}. Ouvrez le lien ci-dessous pour continuer. Contactez Groundwork si vous souhaitez être accompagné.

Footer: Envoyez STOP pour arrêter les rappels.

Button: **Accepter l’invitation** → `https://www.tryjalla.com/{{1}}`

## Remaining setup checks

- Reverify the saved callback in Meta and receive a real signed incoming message.
- The app-subscription GET timed out; subscription status remains unknown until Meta or a real inbound event establishes it.
- The funding-field read returned permission error 10. The owner’s screenshot shows a LeadConnector LLC credit line; review that funding relationship before paid delivery. No billing settings were changed.
- Save the connection/template check after deploying the matching app, configure controlled testing, and review enabled journeys before wider sending.
