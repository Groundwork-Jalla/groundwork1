# Checkpoint model and canonical stage tree
*2 Oct 2026 · specification only · no code, no migration, no seed edits, no budget changes*

> **Status: for approval.** Nothing here is implemented. 104 (production reconciliation)
> proceeds independently; 105+ (checkpoint architecture) waits on this document being
> approved and on the §7 production inventory being run.
>
> **Authority rule.** Sep 13 "Verifier Logic and Standards" is treated as authoritative
> only where it states a decision explicitly. Where it is silent, ambiguous or
> self-contradictory, this document says so and marks the item `NEEDS_DECISION`. Nothing
> is inferred into a decision.

---

## 0 · Why the tree must change before the checkpoints

Sep 13 placed the first foundation checkpoint **after reinforced beams and before
backfilling**. The current seed order is:

```
excavationPitsTrenches → backfill → leanConcrete → reinforcedConcreteFootings
   → foundationPillarsBeams → foundationFloorSlab → foundationBlocksPolystyreneSand
```

`backfill` is second. The beams do not exist yet when it runs. **The required checkpoint
cannot be expressed against this order at all** — not as a hold point, not as a sequence
rule, not as a UI affordance. Building checkpoint enforcement on top of it would encode an
impossible construction sequence into the data model.

That is the whole reason the tree is a prerequisite rather than a parallel task.

---

## 1 · Canonical ten-stage tree

Change classes:

| Class | Meaning |
|---|---|
| `SEQUENCE_ONLY` | Same activities, corrected order or parent. No pricing effect. |
| `STRUCTURAL_WORKFLOW` | Changes how work is tracked or gated. No pricing effect. |
| `BUDGET_AFFECTING` | Touches the estimate, milestones or plan configuration. |
| `NEEDS_DECISION` | Sep 13 is silent, ambiguous or contradictory. |

### Stage 1 — Land Secured · `landSecured`
`engageSurveyor` · `verifyLandTitle` · `engageNotary` · `paymentByBankTransfer` · `landTitleTransfer`

No change proposed. Sep 13 discussed land *verification method* (registry check through the
platform) but did not alter the substages.

### Stage 2 — Design Completed · `designCompleted`
`soilTest` · `architecturalPlans` · `structuralPlan` · `planAuthorization` · `buildingPermitApplication`

No substage change. Sep 13 established that design requires **two independent reviewers** —
an architect for the plan, a civil engineer for the structure — and that the designing
professional may not verify their own work. That is a checkpoint rule (§3), not a tree change.

### Stage 3 — Site Preparation · `sitePreparation`
`energySupply` · `waterSupply` · `clearingAndLeveling` · `magazineConstruction` · `siteMaterialsProcurement`

| Current | Proposed | Source | Class |
|---|---|---|---|
| `meterInstallation` sits under Stage 7 | Contradictory — see below | Sep 13 | `NEEDS_DECISION` |

**Contradiction in the record.** The Sep 13 decisions list says *"Retention of Meter
Installation Stage — the meter installation stage is retained in site preparation as a
failsafe mechanism."* The same meeting's detail notes say *"agreeing to remove metal
installation from site preparation because it is handled elsewhere."* The current tree has
`meterInstallation` under Stage 7, not Stage 3. Three positions, no reconciliation.
**Not resolved here.**

### Stage 4 — Foundation · `foundation`
Fully restated in §2. All changes `SEQUENCE_ONLY` except the new substage and the
`foundationPillarsBeams` split, which is `NEEDS_DECISION`.

### Stage 5 — Structure & Walls · `structureWalls`

| Current | Proposed | Source | Class |
|---|---|---|---|
| `internalExternalPlastering` here | → Stage 8 Finishing | Sep 13 explicit | `SEQUENCE_ONLY` |
| `mortarFlooringTiles` here | → Stage 8 Finishing | Sep 13 explicit | `SEQUENCE_ONLY` |
| `wallTilesDecorativePlaster` here | → Stage 8 Finishing | Sep 13 explicit | `SEQUENCE_ONLY` |

Sep 13 confirmed the structure stage is exactly: *pillars, beams and lintels, staircase,
floor slab, block walls*. After the three moves the current tree already matches that:
`pillars` · `beamsAndLintels` · `staircase` · `structureFloorSlab` · `blockWalls`.

> **Budget caution — and what it is not.** `budget_pct` lives on the STAGE, not the
> substage, so moving substage rows does **not** change any numerical milestone amount.
> Tree 1 recalculates no money.
>
> What changes is the **scope-to-budget alignment**. Existing `budget_pct` values would go
> on producing the same stage amounts, but those amounts would now represent different
> work: Stage 5 keeps its share while losing three activities, and Stage 8 gains three
> while keeping its share. A separate budget review and rebalance decision is therefore
> required — `BUDGET_AFFECTING`, Budget slice (§8), never bundled with the tree fix.

### Stage 6 — Roofing · `roofing`

Sep 13 split roofing into two variants with **different substages**:

**Aluminium** — parapet walls & gutters **first**, then hardwood & truss assembly, purlin
installation, sheet installation, accessories.

**Concrete** — formwork, steel work, concreting, parapet walls & gutters, waterproofing.

| Current | Proposed | Source | Class |
|---|---|---|---|
| One roofing path, no variants | Two variant trees | Sep 13 explicit | `STRUCTURAL_WORKFLOW` |
| No parapet/gutters substage | Aluminium starts with it | Sep 13 explicit | `SEQUENCE_ONLY` within the variant |
| Roof type does not change substages | It selects the tree | Sep 13 explicit | `STRUCTURAL_WORKFLOW` |
| Roof type cost modifiers | Aluminium flat cheaper than concrete flat | Sep 13 — **figures not supplied** | `BUDGET_AFFECTING` + `NEEDS_DECISION` |
| Terrace tiling | Excluded from standard budget | Sep 13 explicit | `BUDGET_AFFECTING` |

The percentage modifiers were assigned to Vanessa and are not in the record. **Variant
substages and variant pricing must ship as separate slices.**

### Stage 7 — Electrical & Plumbing · `electricalPlumbing`

Sep 13: *"separate electrical and plumbing into independent substages within stage seven so
they can run as separate, non-dependent tracks."*

| Current | Proposed | Source | Class |
|---|---|---|---|
| Ten substages in one flat, interleaved list | Two independent tracks | Sep 13 explicit | `STRUCTURAL_WORKFLOW` |
| `septicTankSoakAway` last | Before plumbing verification | Sep 13 explicit | `SEQUENCE_ONLY` |
| Mechanical (AC, water heater) absent | Optional, excluded from estimates | Sep 13 explicit | `BUDGET_AFFECTING` |

**Open:** whether "independent tracks" means two parent keys (two stages) or two groups
under one Stage 7. Sep 13 says *"within stage seven"*, which reads as grouping, not
splitting — but it does not say how a grouped track is gated or verified separately. See §10.

### Stage 8 — Finishing · `finishing`
Receives the three Stage 5 activities. Current: `woodenDoors` · `aluminiumGlassWindows` ·
`ironRailings` · `surfacePreparationPainting` · `externalPaint` · `internalPaint` ·
`ceilingPaintWoodVarnish` · `decorationContingencies`

| Current | Proposed | Source | Class |
|---|---|---|---|
| `decorationContingencies` present | Remove — optional, must not block | Sep 13 explicit | `BUDGET_AFFECTING` |

Removing it is budget-affecting because contingency is a priced line in the fee breakdown
(072). Removing the *tracker substage* and removing the *contingency fee* are different
acts; Sep 13 addressed only the tracker. `NEEDS_DECISION` on whether the fee line stays.

### Stage 9 — Exterior Work · `exteriorWork`
`exteriorLightingDesign` · `waterFeatures` · `exteriorFlooring` · `fencing` · `gardenSeating`

No substage change. Sep 13 assigned verification: civil engineer for everything except
`exteriorLightingDesign`, which is the electrical engineer's. **No written standard document
exists for this stage** — it is the one gap in the 16 standards.

### Stage 10 — Final Handover · `finalHandover`
`fullSystemInspection` · `furnishingCoordination` · `handoverKeysDocumentation`

| Current | Proposed | Source | Class |
|---|---|---|---|
| `furnishingCoordination` present | Remove — optional | Sep 13 explicit | `BUDGET_AFFECTING` |

### Plan configuration

| Current | Proposed | Source | Class |
|---|---|---|---|
| `FinishLevel = standard \| premium \| luxury` | `standard` only | Sep 13 explicit | `BUDGET_AFFECTING` |

This touches `projects_finish_level_check`, the wizard, the budget multipliers and **every
existing project row carrying `premium` or `luxury`**. §7 counts them. Strictly a Budget
slice item.

---

## 2 · Foundation target sequence

The order Sep 13 agreed, with the three checkpoints placed:

| # | Activity | Checkpoint before | Checkpoint after | Hold point | What cannot proceed |
|---|---|---|---|---|---|
| 1 | Excavation of pits & trenches | — | — | — | — |
| 2 | Lean concrete | — | — | — | — |
| 3 | Reinforced concrete footings & pillars | — | — | — | — |
| 4 | Foundation blocks | — | — | — | — |
| 5 | Reinforced beams | — | **CP‑1** | **YES** | backfilling |
| 6 | Backfilling | **CP‑1** | — | — | — |
| 7 | **Pre‑ground‑floor casting** *(new)* | — | **CP‑2** | **YES** | ground‑floor casting |
| 8 | Ground‑floor casting | **CP‑2** | **CP‑3** | no | stage completion |

Pre‑ground‑floor casting contains exactly the five elements Sep 13 listed: plumbing,
electrical earthing, 5 cm sand layer, plastic membrane, steel work.

**Why CP‑1 and CP‑2 are hold points and CP‑3 is not.** Once backfilling covers the beams,
footing size, steel quality and concrete cover cannot be observed again without excavation.
Once the slab is cast, the sand and plastic layers are permanently inaccessible. CP‑3 tests
concrete strength, which is measurable afterwards by lab cube, rebound hammer or core.

---

## 3 · Checkpoint definitions

Every checkpoint below is drawn from Sep 13 or from the 16 reviewed standards documents.
No discipline is named that the materials do not support.

| Key | Stage | After | Discipline(s) | Hold | Blocks | Measured values | Evidence | Signatories |
|---|---|---|---|---|---|---|---|---|
| `land.title` | 1 | `verifyLandTitle` | surveyor / land lawyer | — | — | beacon GPS coords | registry screenshot, cadastral overlay | surveyor + notary + PM *(doc)* |
| `design.architectural` | 2 | `architecturalPlans` | architect *(not the designer)* | — | permit application | — | stamped plan upload | 1 |
| `design.structural` | 2 | `structuralPlan` | civil engineer *(not the designer)* | — | permit application | — | stamped plan + calcs | 1 |
| `design.soil` | 2 | `soilTest` | civil engineer, **on site** | **YES** | foundation design | SPT N‑values per 1.5 m, borehole count/depth, water table, bearing capacity | field logs, lab report | 1 |
| `site.energy` | 3 | `energySupply` | electrical engineer | — | — | meter phase & serial | meter photo, cable video, live‑supply video | 1 |
| `site.water` | 3 | `waterSupply` | civil engineer, **on site during drilling** | **YES** | — | borehole depth, yield, drawdown | drilling video, lab water analysis | 1 |
| `site.tools` | 3 | `siteMaterialsProcurement` | admin / QS | — | — | quantities vs requirement; receipts within **5 %** of standard pricing | receipts, on‑site count | 1 |
| `foundation.beams` | 4 | reinforced beams | civil engineer | **YES** | **backfilling** | foundation depth, footing size, cover, bar diameter/spacing, **lab crush test** | site measurements, photos, video, lab report | 1 |
| `foundation.preCast` | 4 | pre‑ground‑floor casting | civil engineer | **YES** | **ground‑floor casting** | sand depth 5 cm, plastic overlap, steel spacing | photos, video | 1 |
| `foundation.slab` | 4 | ground‑floor casting | civil engineer | — | stage completion | **lab crush test** 7/14/28‑day | lab report | 1 |
| `structure.end` | 5 | end of stage | civil engineer | — | stage completion | concrete strength (lab), rebar diameter & spacing, plumbing flow test | photos, video, lab report | 1 |
| `roofing.aluminium` | 6 | end of stage | civil engineer | — | stage completion | **water flow speed** *(benchmark undefined)*, pitch, overlaps | wood treatment photos, leak test video | 1 |
| `roofing.concrete` | 6 | end of stage | civil engineer | — | stage completion | concrete strength (lab), water flow speed | lab report, video | 1 |
| `electrical.end` | 7 | end of electrical track | electrical engineer | — | stage completion | earth resistance < 10 Ω, insulation > 1 MΩ, polarity | test instrument readings, photos | 1 |
| `plumbing.end` | 7 | end of plumbing track | civil engineer | — | stage completion | hydrostatic pressure, dynamic pressure, **≥ 90 % consistency across outlets** | flow video, report | 1 |
| `finishing.end` | 8 | end of stage | civil engineer **or** architect | — | stage completion | plaster thickness, straightness, paint thickness *(by touch)* | video, photos | 1 |
| `exterior.lighting` | 9 | `exteriorLightingDesign` | electrical engineer | — | — | — | photos, video | 1 |
| `exterior.end` | 9 | end of stage | civil engineer | — | stage completion | concrete strength, garden drainage/water speed, fence strength | photos, video | 1 |
| `handover.final` | 10 | `fullSystemInspection` | architect **and** civil engineer **and** Jalla | — | handover | — | full dossier | **3 — rule undefined, see §4** |

**Three measured-value benchmarks are undefined and were assigned to Vanessa:** roof water
flow speed per region, standard tool/material pricing per town, and the exact plumbing
pressure-consistency measurement method (currently "by naked eye").

---

## 4 · A / B / C status

**C — DECIDED.** Sequential checkpoints are mandatory. Foundation has three. All must be
satisfied. CP‑1 and CP‑2 are hold points blocking the next substage.

**B — PARTIALLY DECIDED.** Final handover requires three parties (architect, civil
engineer, Jalla) and Sep 13 states Jalla's report *"must match the primary report"*. Design
requires two independent reviewers. Electrical/plumbing in Stage 7 are verified by two
different disciplines on two different tracks.

> What is **not** decided: what "must match" means operationally. Does disagreement block
> the stage? Does Jalla's report override? Is there a reconciliation step, and who performs
> it? **This must not be encoded as an all-verifiers-pass database rule on current wording.**

**A — OPEN.** The architect is required at stage 2 (plan review), stage 8 (as an
alternative to the civil engineer) and stage 10 (joint handover). Sep 11 named three
creation-time mandatory roles — civil engineer, electrical engineer, land lawyer — and the
architect is not among them. Nothing in Sep 13 changes that. Whether the architect becomes a
fourth creation-time assignment or is assigned per stage is unresolved.

---

## 5 · What the current schema cannot represent

| Target behaviour | Blocker |
|---|---|
| Two verifiers working one stage at once | `stage_verifications_one_pending_per_stage` — `UNIQUE (stage_id) WHERE decision = 'pending'` (087) |
| Checkpoint identity | `stage_verifications` keys on `stage_id` only. No column distinguishes CP‑1 from CP‑2 on the same stage |
| Hold point before substage progression | Nothing relates a verification to the substage it gates. Substage status is set directly by `markSubstageComplete` with no verification check |
| Several time-separated observations on one element | One `decided_at` per row. 7/14/28‑day crush tests cannot be three dated results against one pour |
| Multiple signatories | One `verifier_id` per row. Land needs three, handover needs three |
| Measured values | `findings text` is free prose. The `checklist jsonb` column exists but **nothing writes it** — `action-center.ts` sets it `null` |
| Evidence requirements | `site_update_id` links one update. No link to documents, so lab reports and calibration certificates have nowhere to attach |
| All-required completion rule | `stage_release_blocker` reads **only the latest** verification: `ORDER BY requested_at DESC … LIMIT 1`. One pass would satisfy the gate even if a sibling checkpoint failed |

The last row is why the index must not be loosened alone: permitting two pending
verifications while the gate still reads one would be **worse than today**.

---

## 6 · Existing projects — two strategies, no choice made

### A · New projects only
Corrected tree seeds only for projects created after the change. Existing projects keep
their current tree and their current (wrong) foundation order.

*Costs:* the checkpoint model needs permanent compatibility behaviour for old-tree
projects; two tree shapes coexist indefinitely; live projects never receive the corrected
checkpoints.

### B · Migrate existing projects
Remap existing rows onto the corrected tree.

**Must be preserved, without exception:**

- `project_stages.id` — `stage_verifications`, `site_updates`, `payments.stage_id` and
  `certificates` all reference it
- substage completion status, `approved_by`, `approved_at`
- `evidence_urls` on substages
- verification history
- `budget_pct`, `payment_milestone_usd`, `fixed_amount_usd`
- every `payments` row's `stage_id` relationship
- `project_audit_log` entity references
- `pre_existing` / `pre_existing_recorded_at` on joined-mid-build projects

**No destructive reseeding.** Deleting and re-inserting substages breaks evidence and
audit references. Migration must be `UPDATE` by stable key, never `DELETE` + `INSERT`.

**Do not choose until §7 has been run.**

---

## 7 · Production inventory (read-only, run before deciding)

```sql
SELECT 'projects by stage'                         AS metric, current_stage::text AS k, count(*)::text AS n
  FROM public.projects WHERE status <> 'archived' GROUP BY current_stage
UNION ALL SELECT 'foundation started or beyond', '', count(*)::text
  FROM public.projects WHERE current_stage >= 4 AND status <> 'archived'
UNION ALL SELECT 'foundation substages not locked', s.name, count(*)::text
  FROM public.project_substages s JOIN public.project_stages ps ON ps.id = s.stage_id
 WHERE ps.stage_number = 4 AND s.status <> 'locked' GROUP BY s.name
UNION ALL SELECT 'backfill already complete', '', count(*)::text
  FROM public.project_substages s JOIN public.project_stages ps ON ps.id = s.stage_id
 WHERE ps.stage_number = 4 AND s.name ILIKE '%backfill%' AND s.status = 'complete'
UNION ALL SELECT 'roofing started', '', count(*)::text
  FROM public.project_stages WHERE stage_number = 6 AND status <> 'locked'
UNION ALL SELECT 'electrical/plumbing started', '', count(*)::text
  FROM public.project_stages WHERE stage_number = 7 AND status <> 'locked'
UNION ALL SELECT 'structure substages moving to finishing, not locked', s.name, count(*)::text
  FROM public.project_substages s JOIN public.project_stages ps ON ps.id = s.stage_id
 WHERE ps.stage_number = 5 AND s.status <> 'locked'
   AND (s.name ILIKE '%plaster%' OR s.name ILIKE '%tile%' OR s.name ILIKE '%floor%')
 GROUP BY s.name
UNION ALL SELECT 'finish level in use', finish_level, count(*)::text
  FROM public.projects GROUP BY finish_level
UNION ALL SELECT 'payments tied to affected stages', '', count(*)::text
  FROM public.payments p JOIN public.project_stages ps ON ps.id = p.stage_id
 WHERE ps.stage_number IN (4,5,6,7)
UNION ALL SELECT 'verifications on affected stages', '', count(*)::text
  FROM public.stage_verifications v JOIN public.project_stages ps ON ps.id = v.stage_id
 WHERE ps.stage_number IN (4,5,6,7)
UNION ALL SELECT 'evidence on affected substages', '', count(*)::text
  FROM public.project_substages s JOIN public.project_stages ps ON ps.id = s.stage_id
 WHERE ps.stage_number IN (4,5,6,7) AND jsonb_array_length(COALESCE(s.evidence_urls,'[]'::jsonb)) > 0;
```

**No writes.** If "backfill already complete" and "payments tied to affected stages" are
both zero, strategy B is cheap. If either is material, grandfathering deserves serious
weight.

---

## 8 · Implementation slices

| Slice | Contains | Class | Depends on |
|---|---|---|---|
| **Tree 1** | Foundation reorder, add `preGroundFloorCasting`, septic reposition, move three activities to Finishing | `SEQUENCE_ONLY` | this spec approved + §7 run |
| **Tree 2** | Electrical/plumbing independent tracks, roofing variant trees | `STRUCTURAL_WORKFLOW` | Tree 1 |
| **Budget** | Finish-tier removal, roofing cost modifiers, `budget_pct` rebalancing after the Stage 5→8 moves, decoration/contingency/furnishing removal | `BUDGET_AFFECTING` | its own review; **never bundled with Tree 1 or 2** |
| **105** | Checkpoint schema — identity, hold points, multiple signatories, measured values, all-required gate | additive | Tree 1 + 104 live |
| **106** | Verification cutover — concurrency index **and** approval/release gate together | — | 105 |

The Budget slice is separate **because the Stage 5 → Stage 8 moves change what each
stage's unchanged amount represents**. No figure moves on its own — `budget_pct` is a stage
column — but after the move Stage 5's share covers less work and Stage 8's covers more.
Deciding whether to rebalance is a reviewed arithmetic change, not a side effect of a tree
fix.

---

## 9 · Sunday decisions

1. **Architect at creation, or per stage?** Three mandatory roles plus architect, or three with the architect assigned when stages 2/8/10 arrive?
2. **What does "must match" mean at handover?** Does disagreement block the stage? Who reconciles? Is Jalla's report authoritative?
3. **Stage 9 standard** — no document exists. Is exterior work verified, or accepted at handover?
4. **Measured values: structured or report-only?** "28-day: 32.4 MPa" as a queryable field, or prose in a signed PDF? This decides whether 105 stores a checklist or a document.
5. **Existing projects: migrate or grandfather?** Answer after §7.
6. **When is the roofing variant chosen?** At project creation from `roof_type`, or later? It changes which substages seed.
7. **Premium/luxury removal** — what happens to existing projects on those tiers, and to their budgets?
8. **Meter installation** — Stage 3 or Stage 7? The Sep 13 record contradicts itself.

---

## 10 · Stable identifiers

The future migration must map by **stable key**, never by display label. Labels are
translated and have already been edited.

### Keys that exist and survive unchanged
`landSecured` · `engageSurveyor` · `verifyLandTitle` · `engageNotary` ·
`paymentByBankTransfer` · `landTitleTransfer` · `designCompleted` · `soilTest` ·
`architecturalPlans` · `structuralPlan` · `planAuthorization` · `buildingPermitApplication` ·
`sitePreparation` · `energySupply` · `waterSupply` · `clearingAndLeveling` ·
`magazineConstruction` · `siteMaterialsProcurement` · `foundation` · `excavationPitsTrenches` ·
`leanConcrete` · `reinforcedConcreteFootings` · `backfill` · `structureWalls` · `pillars` ·
`beamsAndLintels` · `staircase` · `structureFloorSlab` · `blockWalls` · `roofing` ·
`electricalPlumbing` · `finishing` · `woodenDoors` · `aluminiumGlassWindows` · `ironRailings` ·
`surfacePreparationPainting` · `externalPaint` · `internalPaint` · `ceilingPaintWoodVarnish` ·
`exteriorWork` · `exteriorLightingDesign` · `waterFeatures` · `exteriorFlooring` · `fencing` ·
`gardenSeating` · `finalHandover` · `fullSystemInspection` · `handoverKeysDocumentation`

### Activities that change stage but keep identity
These move parent. **Identity must survive so status, evidence and history move with them.**

| Key | From | To |
|---|---|---|
| `internalExternalPlastering` | `structureWalls` | `finishing` |
| `mortarFlooringTiles` | `structureWalls` | `finishing` |
| `wallTilesDecorativePlaster` | `structureWalls` | `finishing` |
| `septicTankSoakAway` | end of Stage 7 | before the plumbing checkpoint |

### Genuinely new keys
`preGroundFloorCasting` (Stage 4) — plus one checkpoint key per row in §3.

### Keys proposed for retirement
| Key | Reason | Class |
|---|---|---|
| `decorationContingencies` | optional, must not block | `BUDGET_AFFECTING` |
| `furnishingCoordination` | optional | `BUDGET_AFFECTING` |

Retirement must not delete rows on projects that have already progressed through them — §7
counts those.

### Variant-specific keys — roofing
Current `roofing` holds one path. Under variants:

- **shared:** `parapetWallsGutters` *(new; first for aluminium, fourth for concrete)*
- **aluminium:** `hardwoodTrussAssembly` · `purlinInstallation` · `roofingSheetInstallation` · `roofAccessoriesFinishing` *(all exist)*
- **concrete:** `roofFormwork` · `roofSteelWork` · `roofConcreting` · `roofWaterproofing` *(all new)*

Existing projects seeded with the aluminium-shaped tree map cleanly; none can currently be
on a concrete path because the concept does not exist.

### ⚠ The one key that cannot map 1:1
`foundationPillarsBeams` is **one key covering two Sep 13 activities that are separated by
other work**:

```
Sep 13:  … footings and pillars → foundation blocks → reinforced beams → backfilling
Current: reinforcedConcreteFootings → foundationPillarsBeams → …
```

Pillars belong before `foundationBlocksPolystyreneSand`; beams belong after it, and CP‑1
sits between beams and backfill. Splitting one key into two means an existing row cannot map
to both without a rule for its status and evidence.

**`NEEDS_DECISION`.** Options, not chosen here: split and carry status to the earlier half;
split and carry to the later half; keep one key and place CP‑1 after it, accepting that the
checkpoint then sits after pillars *and* beams together.

**There is no honest generic transformation.** A rule such as "old complete row → mark both
new pillars and beams complete" cannot be justified: the existing status, approval and
evidence may describe one half, both, or neither separately, and nothing in the row says
which. If existing projects are migrated, this split specifically may need a
project-by-project mapping or grandfathering rather than an automatic transformation. The
§7 query on this key is what decides whether the problem is theoretical or already carries
real history.

Also note `foundationFloorSlab` is Sep 13's "ground-floor casting" and
`foundationBlocksPolystyreneSand` is "foundation blocks" — both map, but the names will
mislead whoever writes the migration. Rename is cosmetic and should **not** be bundled.

### Electrical / plumbing parent keys
Sep 13 says *"within stage seven"*. Two readings, unresolved:

- **grouping** — one `electricalPlumbing` stage, substages tagged by track. Preserves every existing key and `stage_id`. No `payments.stage_id` disturbance.
- **splitting** — two parent stages, e.g. `electrical` and `plumbing`. Cleaner gating, but changes stage count from 10 to 11 and **breaks `joined_at_stage BETWEEN 1 AND 10`, stage numbering, and every `payments.stage_id` on Stage 7**.

Given the blast radius, grouping is the lower-risk reading — but Sep 13 does not say, so
this is `NEEDS_DECISION`.

---

*Nothing in this document has been implemented. No seed, migration, budget or schema file
was modified in producing it.*
