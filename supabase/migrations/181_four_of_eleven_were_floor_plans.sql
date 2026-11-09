-- =========================================================
-- 181  The drawings that ARE floor plans are filed as floor plans
--
-- Runs after 179, which added the category. 179 deliberately left the existing eleven
-- drawings alone on the grounds that "a filename is not evidence". That was right, and
-- this migration does not overturn it: it carries the result of reading every one.
--
-- ── HOW EACH ROW BELOW WAS DECIDED ─────────────────────────────────────────────────
--
-- Every document in the bucket was downloaded, rendered, and read two ways: each sheet's
-- text layer was classified by `src/lib/documents/plan-sheet.ts` (runnable over
-- production as `npm run plan:read -- --all`), and each drawing was also looked at. The
-- two agreed on all twenty.
--
--   "the contractor has uploaded their bill of quantities and floor plan"
--
-- Seven of the eleven are NOT floor plans, and that is the finding, not an oversight:
--
--   AO ---13 - SITE-SECTION-ROOF.pdf     a roof plan and three sections
--   AO---12 - ELEVATION VIEWS.pdf        four elevations
--   AO---14 - FOUNDATION-FLOOR BEAM.pdf  formwork and floor beams
--   Final Structural Toko drawing.pdf    35 sheets, formwork and reinforcement throughout
--   R15.pdf                              PLAN DE FONDATION
--   plan de masse _ 22.5.2026 ++.pdf     PLAN D'AMENAGEMENT — the Youpwe wharf: a quay,
--                                        a crane, a commercial block. Drawn in plan view
--                                        and not a plan of a building.
--   HIPE PROPOSED PLAN 2.pdf             IMPLANTATION 1 — the footprints of an R+5 and
--                                        an R+3 on their plot, nothing inside either.
--
-- A site layout and a foundation plan are both drawn in plan view, which is why a
-- contractor files them as the plan they were asked for. Neither shows a single room.
--
-- ── THE FOUR THAT ARE ──────────────────────────────────────────────────────────────
--
-- Quoted below is the text on the sheet that settled it.
-- =========================================================

-- Mr.Nas Ground Plan.pdf — titled "GROUND PLAN". Three dwellings under one roof:
-- three sitting rooms, three kitchens, three verandas, 21.25 x 10.30 overall.
UPDATE public.project_documents SET category = 'floor_plan'
 WHERE id = 'ded29170-9857-404f-9781-60a684ea3ec1' AND category = 'other';

-- AO---11 - FLOOR PLANS.pdf — titled "GROUND-FIRST-SECOND FLOOR PLANS". Mrs Seraphine's
-- R+3 at Nkolfoulou, with a SHOP SPACE on the ground floor and flats above it.
UPDATE public.project_documents SET category = 'floor_plan'
 WHERE id = '78b57603-332b-4413-981d-58e5ab4903d1' AND category = 'other';

-- PROJET DUPLEX - PLANS - M. KALLA Victor.pdf — a ten-sheet set. Sheets 3, 4 and 10 are
-- plans of a level (SEJOUR / CUISINE / CHAMBRE 1-3 / GARAGE); the other seven are an
-- implantation, two foundation sheets, a roof plan, three elevations and a section.
-- One qualifying sheet makes the file a floor plan: it is what was asked for and sent.
UPDATE public.project_documents SET category = 'floor_plan'
 WHERE id = '6e45c816-8180-4ca9-a3d8-79cb4bb2b2ce' AND category = 'other';

-- R14.pdf — titled "PLAN ETAGE 2 ET 3". Three flats per floor, each CHAMBRE 1,
-- CHAMBRE 2, SALON, CUISINE, TOIL, TERRASSE. Filed under a project named
-- "NGODI ATLANTIC WAREHOUSE", which is a separate problem recorded in 182.
UPDATE public.project_documents SET category = 'floor_plan'
 WHERE id = '1b38faf5-6702-441c-9340-08413a98bf7a' AND category = 'other';

-- ── WHY `AND category = 'other'` ON EVERY ONE ──────────────────────────────────────
--
-- These ids were read on 9 Nov 2026. If a contractor has since refiled one themselves,
-- theirs is the more recent judgement about their own drawing and this must not
-- overwrite it. An UPDATE that matches nothing is the correct outcome in that case.

-- ── NOT TOUCHED, AND WHY ───────────────────────────────────────────────────────────
--
-- Two files filed as `boq` contain a floor plan's worth of room names:
--
--   Mr.NAS G + 1 Cost Estimate Limbe.pdf   rows naming Kitchen, WC, Sitting Room
--   DEVIS FINAL.pdf                        "03 appartements: 01 Salon d'une superficie
--                                          de 25,01m2, 01 cuisine de 6,50m2..."
--
-- Both are bills of quantities and stay that way. A room NAMED IN A SENTENCE is not a
-- room LABELLED ON A SHEET — and both of these read as floor plans to the classifier
-- until it learned to require a drawing's own signature (a stated scale, or a field of
-- bare dimension strings) before trusting a room word at all. They are the regression
-- test in `plan-sheet.test.ts`.

-- ── WHAT THIS CHANGES FOR THE QUALIFIED COUNT ──────────────────────────────────────
--
-- Four projects now hold both a bill of quantities and a floor plan: Mr Nas's G+1 at
-- Limbe, Mrs Seraphine's R+3, the Kalla duplex, and the R14/R15 project. Three others
-- hold a bill and a drawing that is not a plan — Toko, Youpwe and HIPE — and under the
-- memo's definition those are NOT qualified, whatever the drawing is filed as.
--
-- This migration still does not change `project_business_status`. It makes the memo's
-- rule computable against the history as well as against new projects; which rule to
-- run is Philip's call and is recorded as open in 179.
