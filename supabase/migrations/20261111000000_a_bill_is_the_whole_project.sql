-- =========================================================
-- A project priced from a bill of quantities holds the figure that was confirmed,
-- and splits THAT across its stages.
--
-- Runs after 20261110000000_stages_sum_to_construction.sql.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
--
-- Reported 11 Nov 2026, on Brian Home: "after it reads the boq on project creation and
-- displays the right figure, it distributes it wrongly in the stages... even the total
-- budget on the project after its creation is wrong from what the contractor confirmed."
--
-- Both halves are true, and they are two different faults.
--
-- 1. THE TOTAL. `decomposeBudget` inverts the estimator's fee formulas out of whatever
--    total it is given — it exists so an owner who edits their budget still gets
--    components that sum to THEIR number. A bill of quantities is not a number of that
--    kind: it is what the contractor quoted, with no Groundwork fee inside it to
--    recover. Inverting the formulas out of it takes ~12% of their own figure and
--    relabels it as design, permit, project manager and contingency.
--
--    On a build joined mid-way a second reduction follows: `joinedBudget` lowers the
--    total again to the work still to come, and THAT is what reached `budget_usd`. Brian
--    confirmed 59,675,280 XAF and the project stored $80,587 — about 47.2M XAF.
--
-- 2. THE SPLIT. `apply_budget_milestones` shares the CONSTRUCTION fee across the stages,
--    which is right for an estimate (permit, project manager and contingency sit on top
--    of construction) and wrong for a bill (they do not). So 46.371529% of Brian's
--    59,675,280 bill was written as 24,313,931 instead of 27,672,383: the percentage was
--    applied to 87.86% of the bill.
--
-- The code path is fixed in `Step11ConfirmBudget.tsx` for projects created from here on.
-- This migration repairs the ones already created.
--
-- ── WHY ONLY FOUR PROJECTS ─────────────────────────────────────────────────────────
--
-- The bill total is not stored anywhere, so every uploaded bill was re-read (spreadsheets
-- through the app's own extractor, PDFs through poppler into the same `readBqTotal`).
-- Nine projects carry a bill. FIVE OF THE NINE DID NOT READ AS A PROJECT TOTAL:
--
--   NGODI ATLANTIC WAREHOUSE   read 250,000,750,000 off a line called "Gravier 5/15"
--   Mini Port (Youpwe)         read 1,440,000,002 off a "béton armé" line
--   MME TOKO                   read 3,018.12 off "FOUILLES EN PLEINE MASSE"
--   PROJET SS+RDC+10 M TAMSO   read "TOTAL LOT I ... GROS ŒUVRE" — one lot, not the job
--   Dual - Family Duplex       read 29,497,232 from a row carrying two figures
--
-- Writing any of those would be far worse than leaving them alone — the first would put
-- $416 million on a project currently holding $7,499. They are listed at the end for
-- somebody to open the file and state the number, which is the only honest way to get
-- them. A machine reading is evidence; it is not a budget.
--
-- ── WHAT IS DONE TO THE FOUR ───────────────────────────────────────────────────────
--
-- `budget_usd` is set to the bill, converted at the country's STORED rate — not a live
-- one, so this migration produces the same numbers whenever it is run. Then every stage
-- that is still unsettled takes its own percentage of that figure.
--
-- Settled money is never touched: a stage that is paid, complete, pre-existing or on a
-- fixed fee keeps what it has. A pre-existing stage therefore stays at zero, which is
-- correct — it was never funded through Groundwork — and the client is billed for the
-- stages that remain, which is what both screens now derive rather than store.
-- =========================================================

BEGIN;

-- Each row: the project, the figure quoted on its bill, and the line it was read from.
CREATE TEMP TABLE confirmed_bill (
  project_id  uuid PRIMARY KEY,
  bill_local  numeric NOT NULL,
  fx_rate     numeric NOT NULL,
  evidence    text    NOT NULL
) ON COMMIT DROP;

INSERT INTO confirmed_bill (project_id, bill_local, fx_rate, evidence) VALUES
  -- BOQ Sample.xlsx, SUMMARY block: "TOTAL  59675280". The nine section totals above it
  -- (PRELIMINARY 550,000 ... PAINTING 9,742,120) add to exactly this.
  ('6fab6934-23cc-419b-aacf-1ee6f7fb583d', 59675280,     600, 'TOTAL 59675280'),
  -- QUANTITATIVE ESTIMATE ... MME. SERAPHINE.xlsx: "TOTAL  137347500  137347500"
  ('3cdbc05a-7546-491c-b03a-3ede8eef1e60', 137347500,    600, 'TOTAL 137347500'),
  -- Mr.NAS G + 1 Cost Estimate Limbe.pdf: "NET PAYABLE  26,687,728". The same figure the
  -- extractor's own comments cite as this bill's grand total.
  ('48fc6422-57ea-4ae9-aae5-4c5dff67cb1d', 26687728,     600, 'NET PAYABLE 26,687,728'),
  -- Devis_R4_Penthouse_Simplifie_Corrige.xlsx: "TOTAL HORS TAXES  1185805764.8"
  ('cdb6cecd-eaba-4ffe-8bb3-65ec7048e923', 1185805764.8, 600, 'TOTAL HORS TAXES 1185805764.8');

-- Guard: every id above must still carry a bill filed as one. If a document was refiled
-- or removed, this project is no longer what was read and must not be rewritten.
DELETE FROM confirmed_bill c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.project_documents d
    WHERE d.project_id = c.project_id AND d.category = 'boq');

-- ── 1. The total the contractor confirmed ─────────────────────────────────────────
UPDATE public.projects p
   SET budget_usd = round(c.bill_local / c.fx_rate, 2)
  FROM confirmed_bill c
 WHERE p.id = c.project_id
   AND p.budget_usd IS DISTINCT FROM round(c.bill_local / c.fx_rate, 2);

-- ── 2. Distributed across the stages, by their own percentages ────────────────────
-- Unsettled stages only. `budget_pct` is not changed: it is the take-off's share of the
-- building (183) and it is the thing being applied, not the thing being corrected.
UPDATE public.project_stages s
   SET payment_milestone_usd = round(p.budget_usd * s.budget_pct / 100.0, 2)
  FROM public.projects p
  JOIN confirmed_bill c ON c.project_id = p.id
 WHERE s.project_id = p.id
   AND s.budget_pct > 0
   AND COALESCE(s.fixed_amount_usd, 0) = 0
   AND NOT (COALESCE(s.pre_existing, false)
            OR COALESCE(s.payment_status, 'unpaid') = 'paid'
            OR s.status = 'complete')
   AND s.payment_milestone_usd IS DISTINCT FROM round(p.budget_usd * s.budget_pct / 100.0, 2);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.id, p.name, p.budget_usd,
                  (SELECT COALESCE(sum(payment_milestone_usd), 0)
                     FROM public.project_stages s WHERE s.project_id = p.id) AS stage_total
             FROM public.projects p JOIN confirmed_bill c ON c.project_id = p.id
  LOOP
    RAISE NOTICE 'repriced % : budget_usd=% stages now total %',
      r.name, r.budget_usd, r.stage_total;
    PERFORM public.log_activity(r.id, 'project.repriced_from_bill', 'project', r.id, NULL,
      jsonb_build_object('budget_usd', r.budget_usd, 'stage_total_usd', r.stage_total));
  END LOOP;
END $$;

COMMIT;

-- ── STILL WRONG, AND DELIBERATELY NOT TOUCHED HERE ─────────────────────────────────
--
-- These five hold a bill whose total a machine could not read with confidence. Each
-- needs somebody to open the document and state the figure; drop it into the table above
-- with the line it came from and re-run.
--
--   cba1ef68-3f23-43d2-b9dc-6548708d756d  NGODI ATLANTIC WAREHOUSE      holds $7,499
--   237a8cbc-4fbb-468e-855c-5159ef65b8e5  Mini Port (Youpwe)            holds $20,474,254
--   377a2963-b899-4e87-bb30-15516a0d3937  MME TOKO                      holds $55.27
--   b8aa3880-3e74-4df2-87a2-4e50debd5335  PROJET SS+RDC+10 M TAMSO      holds $2,525,167
--   1a1fc897-7287-4397-b4cb-2041db81d11c  Dual - Family Duplex (G+1)    holds $50,192.29
--
-- MME TOKO is the one to look at first: $55.27 cannot be right for a basement-plus-eight
-- storey building in Douala, and that is a reading failure from creation day, not from
-- this migration.
