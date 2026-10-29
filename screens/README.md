# Screens — contractor surface

Proposed redesign of every screen a contractor can reach, 29 October 2026.
Mockups only. **None of this is wired to the app**; nothing here is imported by
`src/`, and nothing in `src/` was changed to produce it. Figures are
illustrative — they are internally consistent across all 22 screens, but they
are not read from a live project.

Each screen is drawn twice: desktop at 1440 × 900 and phone at 390 × 844.

## The screens

### The sidebar

| # | Screen | Desktop | Phone |
|---|---|---|---|
| 1 | **Dashboard** — every build at a glance | `01-dashboard-pc.png` | `01-dashboard-mobile.png` |
| 2 | **Projects** — the full list with filters | `02-projects-pc.png` | `02-projects-mobile.png` |
| 8 | **Payouts** — where you get paid, and what you were paid | `08-payouts-pc.png` | `08-payouts-mobile.png` |
| 9 | **Verification** — what Groundwork checked about you | `09-verification-pc.png` | `09-verification-mobile.png` |
| 10 | **Partner programme** — application, call, what a partner gets | `10-partner-pc.png` | `10-partner-mobile.png` |
| 11 | **Profile** — details, language, dark mode, notifications | `11-profile-pc.png` | `11-profile-mobile.png` |

### Inside a project

| # | Tab | Desktop | Phone |
|---|---|---|---|
| 3 | **Work** — stages and evidence | `03-project-work-pc.png` | `03-project-work-mobile.png` |
| 4 | **Money** — stage by stage, released and still to come | `04-project-money-pc.png` | `04-project-money-mobile.png` |
| 5 | **Documents** — drawings, evidence by stage, certificates | `05-project-documents-pc.png` | `05-project-documents-mobile.png` |
| 6 | **Messages** — the client, the verifier, Groundwork | `06-project-messages-pc.png` | `06-project-messages-mobile.png` |
| 7 | **People** — who has access and what each may do | `07-project-people-pc.png` | `07-project-people-mobile.png` |

### Notes

`design-notes.pdf` — three annotated pages on what changed, why, and what is
still open. `design-notes-1/2/3.png` are the same pages as images, for pasting
into a chat.

## The three ideas

**One spine.** The ten-stage pipeline runs horizontally across every screen —
the same shape the client sees — instead of a set of tabs that each answer a
different question. A contractor learns the shape of a build once and reads
every project the same way after that.

**Evidence ticks the box.** A substage checkbox is not tappable. It fills when a
file lands against it, and the stage goes for verification on its own when the
last one fills. That closes the gap where work is done, a box is ticked, and
nothing was ever uploaded.

**No "needs action" tab.** The open dot on the pipeline *is* the work. A separate
task list would be a second copy of the same truth, free to disagree with it.
The entry is dropped from the sidebar for that reason.

## Still open

1. **Substages per stage.** The four shown on stage 5 are illustrative. The real
   list comes from the database, and whether a contractor may add one on site is
   undecided.
2. **Who sees Money.** Drawn as the contractor's own earnings. An invited client
   opening the same project must not see that tab in those words.
3. **The permission matrix on `07-project-people`** is this proposal's reading of
   the rules, not a copy of them. Worth checking line by line against the
   policies before anyone builds against it.
4. **Partner stage names.** `10-partner` uses Applied → Qualified → Call booked →
   Call held → Partner. If the funnel's own names differ, these should follow
   them rather than the other way round.

## Grounding

Real stage keys from `src/lib/projects/stage-from-description.ts`. Real sidebar
from `src/components/shell/WorkShell.tsx` and `nav-config.ts`, less the dropped
"Needs action" entry. Real copy, where it exists, from `src/lib/i18n/en.ts` —
`contractorPayout`, `documents`, `partner`, `contractorOnboarding`. Colour and
type tokens from `src/styles/globals.css`: Plus Jakarta Sans for headings, Inter
for body, IBM Plex Mono tabular for every figure, `#1f4d36` complete /
`#8a6a2c` awaiting / `#d6d4ce` locked, and state shown as a 6px dot plus
coloured text rather than a tinted pill, as that file requires. Light mode,
which is the app default; dark is the opt-in `html.dark` class.

Money is written as Groundwork writes it: the project's own currency first, the
dollar equivalent beside it, one rate for the day. Nothing says Groundwork holds
or keeps a contractor's money, because it does not.

## Changing a screen

`source/` holds one HTML file per screen plus two shared files:

- `source/app.css` — all the tokens and components. Change a colour here and
  every screen follows.
- `source/shell.js` — the sidebar, the phone tab bar, the project header and the
  pipeline. Change the navigation here and all 22 screens agree.

Open any HTML file in a browser to see it, then re-render the PNGs:

```sh
screens/source/render.sh
```

It needs Google Chrome and a network connection — the pages pull their fonts
from Google Fonts, and without one they fall back to the system sans and the
spacing shifts. Set `CHROME=` to point at a different binary.
