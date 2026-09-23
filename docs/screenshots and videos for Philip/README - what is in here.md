# Groundwork — screenshots and video for Philip

Prepared 23 September 2026. Everything here is the **real Groundwork interface**, captured
from the running application — no mockups, no redrawn screens.

---

## The video

`video/Groundwork - client journey.mp4` — **1 min 15 sec**, no sound.
The client's path end to end: the public site → signing up → the dashboard → describing a
build → the live estimate → tracking the build → stage payments → the verified certificate.

A `.webm` copy sits beside it. Use the **.mp4** for WhatsApp, email, Keynote and LinkedIn;
the .webm is smaller but not accepted everywhere.

---

## The screenshots, in the order that explains the product

**1 — Client: creating a project** (7 shots)
Where they build → how many floors → rooms floor by floor → project details → **the live
estimate and timeline** → choosing a plan → confirming the budget and attaching a BoQ.
*The one to lead with is `05 - live estimate and timeline`: the cost breakdown in USD and
FCFA next to a drawing of their own house. It answers "what is this?" in one image.*

**2 — Client: tracking, milestones and payments** (8 shots)
The dashboard, the project overview, the ten-stage pipeline with per-substage photo
evidence, the timeline, the costing breakdown, **payment released per stage**, documents,
and finances across every build.

**3 — The admin back end** (8 shots)
Overview with live KPIs and the project map, the Action Center queue, all projects, the
per-project workspace, **Reviews & Approvals** (a stage in review, with the evidence
attached), contractor applications, users, and budgets.

**4 — Contractor** (3 shots)
What a contractor sees when invited to a build, and uploading evidence against a stage.

**5 — Verification** (2 shots)
The public certificate anyone can check at `tryjalla.com/verify/<id>`, and the admin screen
where a stage is reviewed and approved today.

---

## Two things to know before you show these

**1. The data is realistic, not real.** "Ada Mbala" and the Mbala Residence are a worked
example — a G+1 in Bonapriso, four stages done, $96,400 budget. Every number is computed
by the real engine (the ten stage milestones sum exactly to the budget), but no client's
information appears anywhere. Site photos are marked **"SITE PHOTO PLACEHOLDER"** on their
face, because putting a stock photo of somebody else's building on a verified record would
be the one thing this product cannot do.

**2. There is no separate verifier login yet.** The verifier **role** exists in the
database, a verifier can be **assigned to a project**, and verification is **recorded and
approved** on the admin screen in folder 5. But a verifier cannot sign in and see only
their assigned project — that view has not been built. Folder 5 shows what exists today,
which is the honest version of "the verifier view".
