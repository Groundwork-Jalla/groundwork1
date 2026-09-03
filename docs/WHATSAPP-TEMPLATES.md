# WhatsApp message templates

Submit these in GHL → **Marketing → Templates** (or Meta Business Manager → WhatsApp
Manager → Message Templates) **before** connecting a number. Approval takes hours to a
day; the number itself can be set up in parallel.

## Why templates exist at all

WhatsApp splits every message into two cases:

- **Inside 24 hours of the contact's last message** — free text, no template, no approval.
- **Outside that window** — a pre-approved template, or nothing is delivered.

Every message below is business-initiated, so every one needs a template. This is the
piece that most often turns "WhatsApp is live" into "WhatsApp is live tomorrow".

## Category matters

Meta reviews against the category you choose, and gets stricter with each escalation:

- **UTILITY** — about a transaction or request the person already started. Approved
  quickly. Everything here is UTILITY.
- **MARKETING** — anything promotional. Slower review, stricter, and subject to
  per-user marketing limits.

**Do not put a call to action in a UTILITY template.** "Come and start a project" makes
it marketing and risks the whole submission.

## Variables

`{{1}}`, `{{2}}` in order of appearance. Meta wants a sample for each at submission —
supply real-looking values, not `test`, or it gets rejected for that alone.

---

## Contractors

### 1. `contractor_application_received` — UTILITY

**English**
```
Hello {{1}}, we have received your application to join the Groundwork contractor
network. Our team is reviewing it and will contact you about the next step. You can
reply to this message if you have any questions.
```
`{{1}}` = Ada

**French**
```
Bonjour {{1}}, nous avons bien reçu votre candidature au réseau d'entrepreneurs
Groundwork. Notre équipe l'examine et vous contactera pour la suite. Vous pouvez
répondre à ce message si vous avez des questions.
```

### 2. `contractor_interview_invitation` — UTILITY

**English**
```
Hello {{1}}, we would like to speak with you about your Groundwork application. Are you
available for a short call on {{2}}? Reply here and we will confirm a time.
```
`{{1}}` = Ada · `{{2}}` = Tuesday 9 September

**French**
```
Bonjour {{1}}, nous souhaitons échanger avec vous au sujet de votre candidature
Groundwork. Seriez-vous disponible pour un bref appel le {{2}} ? Répondez ici et nous
confirmerons un horaire.
```

### 3. `contractor_application_accepted` — UTILITY

**English**
```
Hello {{1}}, your application to the Groundwork contractor network has been accepted.
You can now be matched to projects. Sign in at {{2}} to complete your profile.
```
`{{1}}` = Ada · `{{2}}` = tryjalla.com

**French**
```
Bonjour {{1}}, votre candidature au réseau d'entrepreneurs Groundwork a été acceptée.
Vous pouvez désormais être associé à des projets. Connectez-vous sur {{2}} pour
compléter votre profil.
```

### 4. `contractor_documents_needed` — UTILITY

**English**
```
Hello {{1}}, we need one more document to finish reviewing your Groundwork application:
{{2}}. You can reply here with it, or upload it at {{3}}.
```
`{{1}}` = Ada · `{{2}}` = your tax clearance certificate · `{{3}}` = tryjalla.com

**French**
```
Bonjour {{1}}, il nous manque un document pour terminer l'examen de votre candidature
Groundwork : {{2}}. Vous pouvez l'envoyer ici ou le déposer sur {{3}}.
```

---

## Homeowners

### 5. `project_stage_approved` — UTILITY

**English**
```
Hello {{1}}, stage {{2}} of your project "{{3}}" has been approved. The next payment
milestone is now due. You can review it at {{4}}.
```
`{{1}}` = Marie · `{{2}}` = Foundation · `{{3}}` = Villa Bonapriso · `{{4}}` = tryjalla.com

**French**
```
Bonjour {{1}}, l'étape {{2}} de votre projet « {{3}} » a été validée. Le prochain
versement est maintenant dû. Vous pouvez le consulter sur {{4}}.
```

### 6. `project_rework_requested` — UTILITY

**English**
```
Hello {{1}}, stage {{2}} of "{{3}}" needs some work before it can be approved. The
details are on your dashboard at {{4}}. Reply here if you would like to talk it through.
```
`{{1}}` = Marie · `{{2}}` = Foundation · `{{3}}` = Villa Bonapriso · `{{4}}` = tryjalla.com

**French**
```
Bonjour {{1}}, l'étape {{2}} de « {{3}} » nécessite des corrections avant validation.
Les détails sont sur votre tableau de bord : {{4}}. Répondez ici si vous souhaitez en
discuter.
```

---

## Two things Meta will reject you for

**A template that reads as marketing while filed as UTILITY.** "Start your project
today", "Don't miss out", anything with urgency or an offer. Every template above
describes something the person already began.

**Sample values that look like tests.** `{{1}} = test` gets rejected on sight. Use the
samples given.

## Before you submit

Language codes matter: submit the English ones as `en` and the French as `fr`, with the
**same template name** in both. GHL picks the language per contact, and Groundwork
already knows which each person reads — `preferred_lang` on the profile, and the
`groundwork:en` / `groundwork:fr` tag on every contact.
