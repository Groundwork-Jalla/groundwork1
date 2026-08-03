# Questions for the engineer — BQ calibration

We built Groundwork's budget engine from four of your bills of quantities. The engine now
reproduces them within about −21% to +31%, up from −0% to +146% before. The remaining gap
sits in a small number of specific line items where the four documents disagree with each
other, and we cannot tell from the files alone which reading is right.

None of these block the engine. Each one answered lets us tighten a real tolerance.

**Source documents**

| # | File | Project | Total |
|---|---|---|---|
| 1 | `CONSTRUCTION ESTIMATE OF G+1 BUILDING .xlsx` | Mme. Rose Ndum Kenah, Yaoundé | 59,675,280 XAF |
| 2 | `BUEA RESIDENCE ESTIMATE.xlsx` | Woyamukumbat, Buea | 43,410,955 XAF |
| 3 | `NI PAS CONSTRUCTION ESTIMATE OF G+1 SCHOOL.xlsx` | Naka | 42,213,867 XAF |
| 4 | `MPANGOU.xlsx` | Mpangou, Kribi (G+3) | 64,268,593 XAF |

---

## 1. Roof timber units (document 1)

Item 501 lists **806.20 m³** of treated timber and item 502 a further **520 m³**, on a
125 m² house. That is roughly 500 tonnes of wood. Items 501/502 in the other three
documents are 57–90 m³.

**Is 806.20 linear metres, or board feet, recorded in an m³ column?**

Roof cost per m² of footprint is 48,050 XAF in this document against 5,202 / 6,246 / 9,804
in the other three. We currently price a pitched roof at about 20,000 XAF/m² of footprint
from first principles and treat this figure as an outlier.

## 2. Roof sheet quantity (document 2)

Item 503 lists **42.67 m²** of aluminium sheet on a **224 m²** footprint. A roof over that
footprint needs roughly 250–290 m² of sheet.

**Is a section missing, or is this a flat concrete roof where only a small canopy is
sheeted?** We have assumed the latter, because the document also carries a parapet wall
line (336 m³ at 780 XAF).

## 3. Mpangou floor count (document 4)

The section is headed **"FIRST TILL 3RD FLOOR ELEVATION"** and the file is titled G+3, but
the section total of 24,514,368 is exactly **4 ×** one floor's line items (6,128,592). The
other three documents are exactly 1 × their line items.

**Is Mpangou 3 upper floors or 4?** It changes the per-floor uplift from 20.6% to 15.4%.

## 4. Mpangou foundation (document 4)

Compared with document 3, same 144 m² footprint, half the height:

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

## 5. Blockwork unit of measure

Document 1 prices item 305 at **7,800 XAF/m²** with the quantity in m² (412.80 m² ground,
370 m² first), and its plastering is exactly 2 × that — both faces. Documents 2, 3 and 4
price the same item at **1,750 XAF** against quantities of 1,456 / 936 / 312.

**Is 1,750 per block or per m²?** Neither reading reconciles with the plastered areas in
those three documents. We have adopted the document 1 convention (per m² of wall).

## 6. Internal partitions

Plastered area per floor, against the external envelope both faces:

| Document | Plastered/floor | External envelope, both faces | Internal partitions included? |
|---|---|---|---|
| 1 Rose | 825.60 m² | 268 m² | yes |
| 3 Naka | 777.60 m² | 288 m² | yes |
| 2 Buea | 388.80 m² | 360 m² | **no** |
| 4 Mpangou | 259.20 m² | 288 m² | **no** |

**Do documents 2 and 4 deliberately exclude internal partition walls, or were they
omitted?** We model partitions at 14 m of wall per room per floor — documents 1 and 3 imply
15.5 m and 18 m respectively — so our estimate reads high against documents 2 and 4.

## 7. Painting scope (document 4)

Items 901/902 cover **259.20 m²** — one floor's plastered area — on a four-storey building.
The other three documents paint every floor.

**Should this be 4 × 259.20?**

## 8. Which specification is "standard"?

Normalised for city and area, shell cost per built m² runs 112 → 232 USD across the four.
We have classified documents 2 and 3 as standard finish and document 1 as premium, on the
basis that document 1 has ceiling staffing on both floors, two bathtubs, five mirrors and
1.5M of decoration, while 2 and 3 have none of those.

**Is that the right reading?** It sets our standard / premium / luxury multipliers, which
are currently 1.00 / 1.45 / 1.70.

## 9. Are services quoted or measured?

Section 700 (electrical) totals **2,326,600 XAF in documents 1, 2 and 3 — identical to the
franc** — despite those buildings having 12, 9 and 9 rooms. Section 800 (plumbing) is
identical in documents 2 and 3.

**Are these standard packages you apply, or coincidence?** We currently scale electrical by
floor with a small per-room term. If they are fixed packages, we should say so in the
estimate rather than implying a measurement.

---

## What we did with the price book

The `unit cost calculation` sheet — 8 cities, built up from cement, sand, gravel, steel,
formwork, labour, water and equipment plus 25% overhead and profit — is now the engine's
pricing basis. It cross-validates: each document's concrete rate matches its own city's
column (Rose 180,000 Yaoundé, Buea 190,000 Buea, Mpangou 179,000 Kribi, Naka 190,000 Bali).

Two things follow that we would like confirmed:

- **Adamawa at 260,000 XAF/m³ is 1.44× Douala.** We now price Adamawa builds accordingly.
  Is that spread still current?
- **Abuja at 450,000 XAF/m³ is 2.50× Douala.** Our Nigeria rate was previously set at 1.05×
  Cameroon — the wrong direction entirely. We have rebased it on this column, but we have
  no Nigerian BQ to check it against. Do you have one?
