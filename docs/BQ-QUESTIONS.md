# Questions for the engineer — BQ calibration

*Last updated 9 September 2026. Previous version 16 August.*

We built Groundwork's budget engine from four of your bills of quantities. **Naka now
reproduces to −1.1%** — it is the only one of the four that priced a whole building the
way we do, so it is the honest measure of the engine. The other three each price a
different scope, and the spread across all four is −14.6% to +52.1%.

The remaining gap sits in a small number of specific line items where the four documents
disagree with each other, and we cannot tell from the files alone which reading is right.

**None of these block the engine.** Each one answered lets us tighten a real tolerance or
retire a placeholder.

## What you already settled, 4 September

Thank you — these are in and shipped, so please don't spend time on them again:

- **The timeline.** A bungalow is 14 days, each storey above ground adds 42. That replaced
  a flat 196 days for every building, which gave a bungalow and an eight-storey block the
  same seven months.
- **Professional fees**, as four named lines rather than one flat charge: site manager
  300,000 XAF/month, quantity surveyor 55,000 XAF/month, contract lawyer 100,000 flat,
  project manager 5% of construction. Months come from the timeline rule above.
- **Contingency 2%**, replacing a 5% miscellaneous buffer.
- **Design fee 5,000 XAF/m²** — you confirmed it was already right, so it is unchanged.
- **Site engineer stays inside the 40% labour split.**

## What changed since 16 August

- **The suspended slab is now charged per floor**, not once per building. See the note
  under the accuracy table — this is the single biggest change to the numbers since you
  last saw them, and it is why Mpangou moved.
- **Verification is its own fee line** (50,000 XAF × 7 stages) rather than being folded
  into professional fees.
- The estimate now carries a **warning when it falls below half a rough regional
  benchmark** — see question 17, which is about whether that benchmark is the right one.

## What changed in the version before that

- The engine now emits **line items with your BQ numbering** (204 footings, 305 blockwork,
  503 roof sheet, 801–810 plumbing) rather than section totals, so a Groundwork estimate
  can sit beside a real quotation line for line. That is what makes questions 10 and 15
  answerable at all.
- **Adamawa's index has been corrected from 1.4444 to 1.0750** on your +7–8% figure. This
  raised a new question — see 11.
- **Bali is now listed as Bamenda** in the city picker, carrying Bali's rates unchanged.
- **Boys' quarters no longer carry a cost.** See 14.
- Contractors can now open a project's take-off, override any rate, and submit it back.
  Nine rates currently ship flagged "estimated" because no document backs them — see 15.

---

## Source documents

| # | File | Project | Total (XAF) |
|---|---|---|---|
| 1 | `CONSTRUCTION ESTIMATE OF G+1 BUILDING .xlsx` | Mme. Rose Ndum Kenah, Yaoundé | 59,675,280 |
| 2 | `BUEA RESIDENCE ESTIMATE.xlsx` | Woyamukumbat, Buea | 43,410,955 |
| 3 | `NI PAS CONSTRUCTION ESTIMATE OF G+1 SCHOOL.xlsx` | Naka | 42,213,867 |
| 4 | `MPANGOU.xlsx` | Mpangou, Kribi (G+3) | 64,268,593 |

## Where the engine currently lands

| Document | Yours | Ours | Error | Was, 16 Aug |
|---|---|---|---|---|
| 3 Naka | 42,213,867 | 41,732,608 | **−1.1%** | −5.4% |
| 2 Buea | 43,410,955 | 51,803,389 | +19.3% | +17.5% |
| 1 Rose | 59,675,280 | 50,959,788 | −14.6% | −20.7% |
| 4 Mpangou | 64,268,593 | 97,732,073 | **+52.1%** | +31.1% |

Naka is the closest because it is the only document that measured internal partitions,
painted every floor and priced a whole building — a like-for-like comparison. It is now
within 1.1%.

**Mpangou moved the wrong way on purpose, and it is worth understanding why.** We
corrected a counting error: the engine charged **one** suspended floor slab, one soffit
plaster and one staircase for a building of any height. A suspended slab is the floor of
the storey above it, so a G+3 needs three — we were pricing one. Fixing it added about
8.0M XAF to Mpangou and changed nothing at all on the three G+1 documents.

Mpangou is also the one document that prices a **continuation of a half-built structure** —
your note that "it was incomplete" and that the existing structure was surveyed rather than
re-priced. Slabs already poured are exactly what your quote leaves out and what our number
now includes, so we expect to sit above it. **Is +52% the right distance above a
continuation quote, or does it say we have over-corrected?** That is question 16.

---

## Questions that would move the numbers most

### 1. Roof timber units (document 1)

Item 501 lists **806.20 m³** of treated timber and item 502 a further **520 m³**, on a
125 m² house — roughly 500 tonnes of wood. Items 501/502 in the other three documents are
57–90 m³.

**Is 806.20 linear metres, or board feet, recorded in an m³ column?**

Roof cost per m² of footprint is 48,050 XAF here against 5,202 / 6,246 / 9,804 in the
others. We price a pitched roof at about 20,000 XAF/m² of footprint from first principles
and treat this figure as an outlier — which is part of why we read 14.6% under on Rose.

### 2. Roof sheet quantity (document 2)

Item 503 lists **42.67 m²** of aluminium sheet on a **224 m²** footprint. A roof over that
footprint needs roughly 250–290 m².

**Is a section missing, or is this a flat concrete roof where only a small canopy is
sheeted?** We have assumed the latter, because the document also carries a parapet line
(336 m³ at 780 XAF).

### 3. Mpangou floor count (document 4)

The section is headed **"FIRST TILL 3RD FLOOR ELEVATION"** and the file is titled G+3, but
the section total of 24,514,368 is exactly **4 ×** one floor's line items (6,128,592). The
other three documents are exactly 1 × their line items.

**Is Mpangou 3 upper floors or 4?** It changes the per-floor uplift from 20.6% to 15.4%,
and it is a direct contributor to our +52.1% on this document. It now matters more than
it did in August: the slab correction in question 16 is charged per upper floor, so the
floor count decides how many slabs we price.

### 4. Mpangou foundation (document 4)

Same 144 m² footprint as document 3, half the height:

| Item | Mpangou (G+3) | Naka (G+1) | ratio |
|---|---|---|---|
| Excavation | 40.32 m³ | 112.32 m³ | 0.36× |
| RC footings (204) | 0.69 m³ | 11.66 m³ | **0.06×** |
| RC foundation beams (206) | 2.16 m³ | 6.48 m³ | 0.33× |
| Preliminary (100) | 170,000 | 830,000 | 0.20× |

A four-storey building needs larger footings than a two-storey one on the same footprint,
not sixteen times smaller.

**Was this foundation designed for a different structure, or is the schedule incomplete?**
We have excluded this document from the foundation calibration.

### 5. Blockwork unit of measure

Document 1 prices item 305 at **7,800 XAF/m²** with quantities in m² (412.80 ground,
370 first), and its plastering is exactly 2 × that — both faces. Documents 2, 3 and 4 price
the same item at **1,750 XAF** against quantities of 1,456 / 936 / 312.

**Is 1,750 per block or per m²?** Neither reading reconciles with the plastered areas in
those three documents. We have adopted the document 1 convention (per m² of wall).

This one now matters more than it did: a contractor editing item 305 in Groundwork sees a
unit beside the box, and they need to know what they are pricing.

### 6. Internal partitions

Plastered area per floor, against the external envelope both faces:

| Document | Plastered/floor | External envelope, both faces | Partitions included? |
|---|---|---|---|
| 1 Rose | 825.60 m² | 268 m² | yes |
| 3 Naka | 777.60 m² | 288 m² | yes |
| 2 Buea | 388.80 m² | 360 m² | **no** |
| 4 Mpangou | 259.20 m² | 288 m² | **no** |

**Do documents 2 and 4 deliberately exclude internal partition walls, or were they
omitted?** We model partitions at 14 m of wall per room per floor — documents 1 and 3 imply
15.5 m and 18 m — so our estimate reads high against 2 and 4. That is most of our +19.3%
on Buea.

### 7. Painting scope (document 4)

Items 901/902 cover **259.20 m²** — one floor's plastered area — on a four-storey building.
The other three paint every floor.

**Should this be 4 × 259.20?**

### 8. Which specification is "standard"?

Normalised for city and area, shell cost per built m² runs 112 → 232 USD across the four.
We classify documents 2 and 3 as standard and document 1 as premium, because document 1 has
ceiling staffing on both floors, two bathtubs, five mirrors and 1.5M of decoration where
2 and 3 have none.

**Is that the right reading?** It sets our standard / premium / luxury multipliers, which
are **1.00 / 1.45 / 1.70**.

### 9. Are services quoted or measured?

Section 700 (electrical) totals **2,326,600 XAF in documents 1, 2 and 3 — identical to the
franc** — despite 12, 9 and 9 rooms. Section 800 (plumbing) is identical in 2 and 3.

**Are these standard packages you apply, or coincidence?** We scale electrical by floor
with a small per-room term. If they are fixed packages we should label items 701/702
"package — quoted" with no quantity, rather than showing a contractor a measurement we
did not measure.

---

## New in the August round

### 10. Mpangou has no mirrors (document 4)

Our fixture schedule reproduces documents 1, 2 and 3 **to the franc** (6,450,000 /
2,255,000 / 2,255,000). Document 4 is the one it misses.

We give a mirror to every bathroom on a premium or luxury specification. Document 4 is
plainly luxury — it carries 5 bathtubs, 8 showers and 5 kitchen sinks — but lists **no
mirrors at all** under item 807.

**Is that an omission, or do you not price mirrors on this kind of job?** We have left our
rule alone rather than special-casing it, so today we show 3 mirrors where your document
shows none.

### 11. Is Adamawa +7–8% overall, or +7–8% on labour and materials?

We corrected the Adamawa index from 1.4444 to **1.0750** on your figure. But an identical
building still prices **15.2%** above Douala, not 7.5%, and that is not an error in the
correction:

- We take concrete straight from each city's own column, and Adamawa's is **260,000 XAF/m³
  against Douala's 180,000** — 44% higher on inland haulage.
- The index is applied to everything else — labour, blocks, tiles, paint.
- Concrete is about 21% of a take-off, so `1.075 × 0.79 + 1.444 × 0.21 ≈ 1.15`.

**Does your +7–8% describe the finished project, or the non-concrete trades?** If it is the
finished project, then the Adamawa concrete column is also overstated and both need to move
together.

### 12. Roof material uplifts

We found three different sets of roof multipliers in our own system — the rate card said
clay +10%, a fallback said +5%, and the interface showed clients +5% while charging +10%.
That is fixed; everything now uses one set:

| Covering | Uplift over long-span aluminium |
|---|---|
| Long-span aluminium | base |
| Clay tiles | +10% |
| Concrete slab | +8% |
| Shingle | +5% |
| **Aluminium deck (flat)** | **base — assumed, not measured** |

**Are the first four right?** And we have added a **flat aluminium deck** as an option,
which none of the four documents covers. We price it at the long-span rate because it is
the same sheet laid to a shallow fall. **Is that reasonable, or does the decking, falls and
upstand detail put it closer to a concrete slab?**

### 13. Footprint benchmarks

You put a 5-bedroom 2-storey semi-detached at **120 m² per floor**. We were suggesting 95,
so we recalibrated the room sizes to hit your figure:

| Room | m² | | Room | m² |
|---|---|---|---|---|
| Bedroom | 17 | | Kitchen | 15 |
| Bathroom | 6 | | Home office | 12 |
| Living | 32 | | Circulation | +30% |

`(5×17 + 5×6 + 2×32 + 15) × 1.30 × 0.95 ÷ 2 = 120` ✓

**Are the individual room sizes right, or only the total?** They drive every footprint the
wizard suggests, and a client who accepts the suggestion is accepting these numbers.

We have also added **home office** as a room type, since it seems standard in the briefs
diaspora clients bring. 12 m² is our guess.

### 14. Boys' quarters — can you price one?

We were adding **$8,000 per room** for staff quarters. That figure had nothing behind it and
was 19–27% of a typical client's total, so we have **removed it entirely**. The wizard still
asks whether they want one; it now costs nothing and says so.

**Can you send a BoQ for a typical staff quarters block** — say 2 rooms with a shared
bathroom — so we can price it honestly? Until then we cannot quote it at all.

### 15. Nine rates with nothing behind them

Now that the engine emits your item numbers, every rate is visibly either measured from your
documents or inferred by us. These nine are inferred, and a contractor sees them flagged
"est." in the interface:

| Item | Description | What we assume |
|---|---|---|
| 101 | Site setup, hoarding, temporary works | 250,000 XAF lump |
| 102 | Site clearing and setting out | 1,600 XAF/m² |
| 207 | Damp-proof membrane | 1,000 XAF/m² |
| 208 | Sand blinding | 1,000 XAF/m² |
| 501 | Parapet wall | 4,500 XAF/ml |
| 502 | Roof timber and trusses | 6,500 XAF/m² |
| 701 | Electrical, per floor | 700,000 XAF |
| 702 | Electrical, per room | 90,000 XAF |
| 907 | Final finishes allowance | 500,000 XAF lump |

**Do any of these have a real rate you can give us?** We would rather drop a line than ship
an invented figure inside it — a contractor who spots one made-up number stops trusting the
whole document.

## New in this round — September

### 16. Mpangou — how far above a continuation quote should we be?

Covered under the accuracy table. We now sit **+52.1%** above your Mpangou figure, up from
+31.1%, because we corrected the slab count. Your document prices one contractor's
continuation of a half-built structure; ours prices the whole building from scratch, so
some gap is correct.

**Roughly what proportion of that project was already standing when you took it over?**
Even a rough fraction tells us whether +52% is the right distance or whether we have
over-corrected.

### 17. Is 180,000 XAF/m² a real rule of thumb, or our own concrete rate handed back?

On 4 September you gave us a quick check: a Yaoundé build runs about **180,000 XAF per
built m²** — footprint × floors × 180,000. We use it exactly as you described it, as a
sanity check and never as a price: if our estimate lands below half of it, the client is
told the figure looks low for a building that size and to have a contractor confirm it.

The reason for the question is a coincidence we would rather not build on. Your own price
book puts **Yaoundé RC-350 concrete at 180,000 XAF per m³** — the same number, a different
quantity, a different unit.

**Is the per-m² rule of thumb genuinely 180,000, or was that the concrete rate?** Both are
plausible on their own, which is exactly why we do not want to guess. If it is the concrete
rate, our warning is calibrated against the wrong figure and will fire in the wrong places.

### 18. Cost per m² still falls as a building gets taller — should it?

With the slab fix in, a Yaoundé building at a fixed footprint prices like this against the
180,000 rule of thumb:

| Storeys | Our cost ÷ rule of thumb |
|---|---|
| 1 | 1.29 |
| 2 | 0.84 |
| 4 | 0.70 |
| 8 | 0.63 |
| 12 | 0.61 |

Going from one storey to eight, we lose about **49%** of the ratio. Before the slab fix it
was 62%, so the correction closed roughly a fifth of the gap — but not the rest.

Some decay is real: a foundation and a site setup are paid once and spread over more floor
area. **Is roughly half the right amount to lose over eight storeys, or should a tall
building cost nearer a flat rate per m²?** We have no mechanism left that explains the
remainder, and we would rather ask than invent one.

Two smaller ones in the same area:

- **Should a bungalow be charged a suspended floor slab at all?** We charge one today. A
  single-storey building under a pitched roof does not have one, so this looks like an
  over-charge — but no document in the set is a bungalow, so there is nothing to calibrate
  against, and it is the commonest building our clients ask for.
- **Partition walls and bathroom tiling scale with the total room count, not per floor.**
  So a tall building with a fixed number of rooms gets a shrinking allowance per floor.
  Is that right?

---

## The price book

The `unit cost calculation` sheet — 8 cities, built up from cement, sand, gravel, steel,
formwork, labour, water and equipment plus 25% overhead and profit — is the engine's pricing
basis. It cross-validates: each document's concrete rate matches its own city's column
(Rose 180,000 Yaoundé, Buea 190,000 Buea, Mpangou 179,000 Kribi, Naka 190,000 Bamenda).

One thing still open:

- **Abuja at 450,000 XAF/m³ is 2.50× Douala.** We have three different Nigerian base rates
  in our own system — 672, 1,600 and 180 USD/m² — none of which has a Nigerian bill of
  quantities behind it. **Do you have one, or know someone who does?** Until then we are
  guessing, and we would rather say so on screen than pretend otherwise.

Adamawa is covered in question 11 above.

---

## What we would do with the answers

| Answered | Effect |
|---|---|
| 1, 3, 4, 6, 7 | Tighten our tolerance from ±25/35% toward ±10%, and stop excluding documents from calibration |
| 5, 9, 15 | Contractors can price against our lines without translating them first |
| 10 | The fixture schedule reproduces all four documents instead of three |
| 11 | Adamawa clients get a defensible number |
| 12, 13 | Every footprint and roof the wizard suggests rests on your figures rather than ours |
| 14 | We can quote staff quarters at all |
| **16** | We know whether the slab correction landed in the right place or overshot |
| **17** | The under-estimate warning is calibrated against a real benchmark, not a coincidence |
| **18** | Tall buildings are priced on your judgement rather than on an unexplained decay |

**If you can only answer three, make them 17, 18 and 15.** 17 and 18 decide whether tall
buildings are priced correctly at all, which is the gap our beta testers actually
complained about; 15 is nine invented rates that a contractor can currently see flagged as
guesses.

The re-baselined Bill of Quantity you mentioned would settle several of these at once — if
it is close, we can wait for it rather than take your time twice.
