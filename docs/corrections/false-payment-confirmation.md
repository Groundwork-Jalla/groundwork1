# Correction: false payment-confirmation emails

**Status: DRAFT. Nothing has been sent. This is copy for review.**

## What happened

A GoHighLevel workflow named *Founding Member/Community Access Payment series*, created in
April by someone outside the current team, had a `Contact Created` trigger with **no
filters**. Every contact created in the sub-account was enrolled, tagged
`paying-founding-member`, and sent a sequence of up to five emails beginning:

> **Subject:** Payment Confirmation - Thank You for Your Purchase
> Thank you for your recent payment. We have successfully received your payment and you are
> now a Founding Member!

Sent as *The Jalla Community* from `contact@tryjalla.com`.

Most enrolments were **skipped** because the contact had no email address — a side effect of
the duplicate-contact bug in the old Contractor Application workflow. The ones that did send
went to contacts with real addresses: contractors who had just applied, and platform signups.

The workflow was set to **Draft** on 26 Aug 2026, which stopped both new enrolments and the
sequences already in flight.

**No money was taken from anyone.** A query against `public.profiles` returned zero rows with
a Stripe subscription, so nobody was charged through the platform. Confirm separately whether
any founding-member fee was ever collected outside Stripe.

## Who to send to

From GHL → the workflow → Execution logs, filtered to **Action = Send email**, **Status =
Executed**, with the date range starting **1 April 2026**. Exclude `Crm Test Accepted` and
`Crm Test signup` — those are ours.

Send once per person, not once per email they received.

---

## English

**Subject:** Correction: you did not make a payment to Jalla

Hello {{first_name}},

You recently received one or more emails from us confirming a payment and welcoming you as a
Founding Member.

**Those emails were sent in error.** You have not paid us anything, and no money has been
taken from you. They were sent automatically by a system that was set up incorrectly, and they
reached people who never made a payment.

Nothing about your account or your application has changed. If you applied to join our
contractor network, your application is being reviewed normally and this does not affect it.

We are sorry for the confusion. If you have any question at all about this — including if you
believe you *did* pay us something — please reply to this email and we will answer you
directly.

The Jalla team

---

## Français

**Objet :** Correction : vous n'avez effectué aucun paiement auprès de Jalla

Bonjour {{first_name}},

Vous avez récemment reçu un ou plusieurs e-mails de notre part confirmant un paiement et vous
accueillant en tant que Membre Fondateur.

**Ces e-mails ont été envoyés par erreur.** Vous ne nous avez rien payé et aucune somme ne
vous a été prélevée. Ils ont été envoyés automatiquement par un système mal configuré, et ils
sont parvenus à des personnes n'ayant effectué aucun paiement.

Rien n'a changé concernant votre compte ou votre candidature. Si vous avez postulé pour
rejoindre notre réseau d'entrepreneurs, votre candidature suit son cours normalement et n'est
en rien affectée.

Nous sommes désolés pour la confusion. Si vous avez la moindre question à ce sujet — y compris
si vous pensez nous avoir *effectivement* versé quelque chose — répondez à cet e-mail et nous
vous répondrons directement.

L'équipe Jalla

---

## Notes on the wording

- **The subject line states the correction outright.** A vague subject ("About a recent email")
  gets opened later or not at all, and the whole point is that the reader stops believing
  something untrue as soon as possible.
- **"No money has been taken from you"** is the sentence that matters most. Someone who half-read
  a payment confirmation may be wondering what was charged.
- **It invites the opposite reply.** If anyone genuinely did pay by transfer or MoMo, this email
  would otherwise tell them their payment does not exist. The last paragraph catches that.
- **No explanation of GoHighLevel, workflows or triggers.** The reader does not need the
  mechanism, only the correction.
- It does not promise a process change, because no one outside the team is owed one here.

## Sending

Not wired up. When approved, this goes out through Resend from the verified domain — entirely
separate from GoHighLevel, so it cannot re-enter the workflow or re-trigger anything.
